#!/usr/bin/env python3
"""Firefox-friendly local Bluetooth bridge for Ubuntu.

Protocol over WebSocket:
{
  "type": "send_frame",
  "packet_id": "packet-...",
  "device_address": "AA:BB:CC:DD:EE:FF",
  "characteristic_uuid": "0000ffe1-0000-1000-8000-00805f9b34fb",
  "chunk_size": 180,
  "chunk_delay_ms": 15,
  "ack_every_chunks": 10,
  "ack_characteristic_uuid": "0000ffe2-0000-1000-8000-00805f9b34fb",
  "ack_expected_hex": "aa55",
  "max_retries": 2,
  "data_base64": "..."
}
"""

import asyncio
import base64
import json
import math
from typing import Any

from bleak import BleakClient
from websockets.asyncio.server import serve


def chunk_bytes(frame: bytes, chunk_size: int) -> list[bytes]:
  if chunk_size <= 0:
    return [frame]
  return [frame[i : i + chunk_size] for i in range(0, len(frame), chunk_size)]


def normalize_hex(value: str) -> str:
  return value.strip().lower().replace(" ", "")


async def verify_ack(client: BleakClient, ack_uuid: str, ack_expected_hex: str) -> bool:
  if not ack_uuid:
    return True

  ack_bytes = await client.read_gatt_char(ack_uuid)
  if not ack_expected_hex:
    return len(ack_bytes) > 0

  return ack_bytes.hex().lower() == normalize_hex(ack_expected_hex)


async def write_group(
  client: BleakClient,
  group: list[bytes],
  characteristic_uuid: str,
  chunk_delay_ms: int
) -> None:
  for chunk in group:
    await client.write_gatt_char(characteristic_uuid, chunk, response=False)
    if chunk_delay_ms > 0:
      await asyncio.sleep(chunk_delay_ms / 1000)


async def handle_send_frame(payload: dict[str, Any], websocket) -> None:
  packet_id = payload.get("packet_id", "")
  address = payload.get("device_address", "").strip()
  characteristic_uuid = payload.get("characteristic_uuid", "").strip()
  encoded_data = payload.get("data_base64", "")
  chunk_size = int(payload.get("chunk_size", 180))
  chunk_delay_ms = int(payload.get("chunk_delay_ms", 15))
  ack_every_chunks = int(payload.get("ack_every_chunks", 0))
  ack_characteristic_uuid = payload.get("ack_characteristic_uuid", "").strip()
  ack_expected_hex = payload.get("ack_expected_hex", "")
  max_retries = int(payload.get("max_retries", 2))

  if not address or not characteristic_uuid or not encoded_data:
    await websocket.send(json.dumps({"ok": False, "error": "missing required fields"}))
    return

  frame = base64.b64decode(encoded_data)
  chunks = chunk_bytes(frame, chunk_size)
  total_chunks = max(1, len(chunks))

  group_size = ack_every_chunks if ack_every_chunks > 0 else total_chunks
  groups = [chunks[i : i + group_size] for i in range(0, total_chunks, group_size)]

  async with BleakClient(address) as client:
    sent_chunks = 0

    for group_index, group in enumerate(groups, start=1):
      attempt = 0
      while True:
        await write_group(client, group, characteristic_uuid, chunk_delay_ms)
        ack_ok = await verify_ack(client, ack_characteristic_uuid, ack_expected_hex)

        if ack_ok:
          sent_chunks += len(group)
          await websocket.send(
            json.dumps(
              {
                "type": "progress",
                "packet_id": packet_id,
                "sent_chunks": sent_chunks,
                "total_chunks": total_chunks,
                "percent": math.floor((sent_chunks / total_chunks) * 100)
              }
            )
          )
          break

        attempt += 1
        if attempt > max_retries:
          await websocket.send(
            json.dumps(
              {
                "ok": False,
                "packet_id": packet_id,
                "error": f"ack verify failed at group {group_index} after {max_retries} retries"
              }
            )
          )
          return

        await websocket.send(
          json.dumps(
            {
              "type": "retry",
              "packet_id": packet_id,
              "group_index": group_index,
              "attempt": attempt,
              "max_retries": max_retries
            }
          )
        )

  await websocket.send(
    json.dumps({"type": "done", "packet_id": packet_id, "bytes": len(frame), "chunks": total_chunks})
  )


async def ws_handler(websocket):
  async for raw_message in websocket:
    try:
      payload = json.loads(raw_message)
      msg_type = payload.get("type")
      if msg_type == "send_frame":
        await handle_send_frame(payload, websocket)
      else:
        await websocket.send(json.dumps({"ok": False, "error": "unsupported message type"}))
    except Exception as error:
      await websocket.send(json.dumps({"ok": False, "error": str(error)}))


async def main() -> None:
  async with serve(ws_handler, "127.0.0.1", 8765):
    print("Bluetooth bridge listening on ws://127.0.0.1:8765")
    await asyncio.Future()


if __name__ == "__main__":
  asyncio.run(main())
