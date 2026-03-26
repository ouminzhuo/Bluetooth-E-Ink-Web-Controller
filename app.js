const elements = {
  textInput: document.getElementById('textInput'),
  orientation: document.getElementById('orientation'),
  textColor: document.getElementById('textColor'),
  fontSize: document.getElementById('fontSize'),
  lineHeight: document.getElementById('lineHeight'),
  padding: document.getElementById('padding'),
  textAlign: document.getElementById('textAlign'),
  onlineFont: document.getElementById('onlineFont'),
  useOnlineFont: document.getElementById('useOnlineFont'),
  fontFile: document.getElementById('fontFile'),
  fontStatus: document.getElementById('fontStatus'),
  previewBtn: document.getElementById('previewBtn'),
  exportBtn: document.getElementById('exportBtn'),
  previewFrame: document.getElementById('previewFrame'),
  ditherCanvas: document.getElementById('ditherCanvas'),
  bluetoothHint: document.getElementById('bluetoothHint'),
  bluetoothStatus: document.getElementById('bluetoothStatus'),
  bridgeUrl: document.getElementById('bridgeUrl'),
  deviceAddress: document.getElementById('deviceAddress'),
  characteristicUuid: document.getElementById('characteristicUuid'),
  chunkSize: document.getElementById('chunkSize'),
  chunkDelay: document.getElementById('chunkDelay'),
  ackEveryChunks: document.getElementById('ackEveryChunks'),
  ackCharacteristicUuid: document.getElementById('ackCharacteristicUuid'),
  ackExpectedHex: document.getElementById('ackExpectedHex'),
  maxRetries: document.getElementById('maxRetries'),
  sendProgress: document.getElementById('sendProgress'),
  sendProgressText: document.getElementById('sendProgressText'),
  connectBridgeBtn: document.getElementById('connectBridgeBtn'),
  sendBridgeBtn: document.getElementById('sendBridgeBtn')
};

let currentFontFamily = 'Noto Sans SC';
let latestSvgText = '';
let bridgeSocket = null;
let currentPacketId = '';

const escapeXml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

function setBluetoothHint() {
  if (navigator.bluetooth) {
    elements.bluetoothHint.textContent = '当前浏览器支持 Web Bluetooth，可扩展为浏览器直连。';
    return;
  }
  elements.bluetoothHint.textContent =
    'Firefox 当前不支持 Web Bluetooth。建议通过本地桥接服务（BlueZ + WebSocket）发送。';
}

function setProgress(percent) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  elements.sendProgress.value = clamped;
  elements.sendProgressText.textContent = `${clamped}%`;
}

function getCanvasSize() {
  if (elements.orientation.value === 'portrait') {
    return { width: 300, height: 400 };
  }
  return { width: 400, height: 300 };
}

function getTextAnchor() {
  const align = elements.textAlign.value;
  if (align === 'middle') {
    return { anchor: 'middle', xRatio: 0.5 };
  }
  if (align === 'end') {
    return { anchor: 'end', xRatio: 1 };
  }
  return { anchor: 'start', xRatio: 0 };
}

function buildSvg() {
  const { width, height } = getCanvasSize();
  const text = elements.textInput.value || '请输入文字';
  const lines = text.split('\n').map(escapeXml);
  const fontSize = Number(elements.fontSize.value);
  const lineHeightFactor = Number(elements.lineHeight.value);
  const padding = Number(elements.padding.value);
  const { anchor, xRatio } = getTextAnchor();
  const x = padding + (width - padding * 2) * xRatio;
  const yStart = padding + fontSize;

  const tspans = lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : fontSize * lineHeightFactor;
      return `<tspan x="${x}" dy="${dy}">${line || ' '}</tspan>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text
    x="${x}"
    y="${yStart}"
    fill="${elements.textColor.value}"
    font-family="${escapeXml(currentFontFamily)}"
    font-size="${fontSize}"
    text-anchor="${anchor}"
    dominant-baseline="text-before-edge"
    style="white-space: pre;"
  >${tspans}</text>
</svg>`;
}

function renderPreview() {
  latestSvgText = buildSvg();
  elements.previewFrame.innerHTML = latestSvgText;
  renderAtkinsonSimulation(latestSvgText);
}

function closestPaletteColor(r, g, b) {
  const palette = [
    { r: 255, g: 255, b: 255, code: 0 },
    { r: 0, g: 0, b: 0, code: 1 },
    { r: 255, g: 0, b: 0, code: 2 }
  ];

  let best = palette[0];
  let bestDistance = Infinity;

  for (const color of palette) {
    const dr = r - color.r;
    const dg = g - color.g;
    const db = b - color.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDistance) {
      bestDistance = dist;
      best = color;
    }
  }

  return best;
}

function distributeError(buffer, width, height, x, y, er, eg, eb) {
  const points = [
    [1, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2]
  ];

  for (const [dx, dy] of points) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
      continue;
    }
    const idx = (ny * width + nx) * 4;
    buffer[idx] += er / 8;
    buffer[idx + 1] += eg / 8;
    buffer[idx + 2] += eb / 8;
  }
}

function renderAtkinsonSimulation(svgText) {
  const { width, height } = getCanvasSize();
  elements.ditherCanvas.width = width;
  elements.ditherCanvas.height = height;

  const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();

  img.onload = () => {
    const ctx = elements.ditherCanvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const floatBuffer = new Float32Array(data.length);

    for (let i = 0; i < data.length; i += 1) {
      floatBuffer[i] = data[i];
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        const oldR = floatBuffer[idx];
        const oldG = floatBuffer[idx + 1];
        const oldB = floatBuffer[idx + 2];
        const mapped = closestPaletteColor(oldR, oldG, oldB);

        data[idx] = mapped.r;
        data[idx + 1] = mapped.g;
        data[idx + 2] = mapped.b;
        data[idx + 3] = 255;

        const er = oldR - mapped.r;
        const eg = oldG - mapped.g;
        const eb = oldB - mapped.b;
        distributeError(floatBuffer, width, height, x, y, er, eg, eb);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    URL.revokeObjectURL(url);
  };

  img.src = url;
}

function get2BitPackedPayload() {
  const { width, height } = getCanvasSize();
  const ctx = elements.ditherCanvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const totalPixels = width * height;
  const packed = new Uint8Array(Math.ceil(totalPixels / 4));

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += 1) {
    const idx = pixelIndex * 4;
    const mapped = closestPaletteColor(imageData[idx], imageData[idx + 1], imageData[idx + 2]);
    const byteIndex = Math.floor(pixelIndex / 4);
    const bitOffset = (3 - (pixelIndex % 4)) * 2;
    packed[byteIndex] |= mapped.code << bitOffset;
  }

  return packed;
}

function uint8ToBase64(bytes) {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function handleBridgeMessage(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    elements.bluetoothStatus.textContent = `桥接响应：${raw}`;
    return;
  }

  if (payload.type === 'progress' && payload.packet_id === currentPacketId) {
    const percent = payload.total_chunks
      ? (payload.sent_chunks / payload.total_chunks) * 100
      : 0;
    setProgress(percent);
    elements.bluetoothStatus.textContent = `发送中：${payload.sent_chunks}/${payload.total_chunks}`;
    return;
  }

  if (payload.type === 'retry' && payload.packet_id === currentPacketId) {
    elements.bluetoothStatus.textContent = `ACK 校验失败，正在重试：组 ${payload.group_index}，第 ${payload.attempt}/${payload.max_retries} 次`;
    return;
  }

  if (payload.type === 'done' && payload.packet_id === currentPacketId) {
    setProgress(100);
    elements.bluetoothStatus.textContent = `发送完成：${payload.bytes} 字节。`;
    return;
  }

  if (payload.ok === false) {
    elements.bluetoothStatus.textContent = `发送失败：${payload.error}`;
    return;
  }

  elements.bluetoothStatus.textContent = `桥接响应：${raw}`;
}

function connectBridge() {
  if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
    elements.bluetoothStatus.textContent = '桥接服务已连接。';
    return;
  }

  bridgeSocket = new WebSocket(elements.bridgeUrl.value.trim());
  bridgeSocket.onopen = () => {
    elements.bluetoothStatus.textContent = '桥接服务连接成功。';
  };

  bridgeSocket.onmessage = (event) => {
    handleBridgeMessage(event.data);
  };

  bridgeSocket.onerror = () => {
    elements.bluetoothStatus.textContent = '桥接服务连接失败，请确认 Ubuntu 端 bridge 已启动。';
  };

  bridgeSocket.onclose = () => {
    elements.bluetoothStatus.textContent = '桥接服务连接已关闭。';
  };
}

function sendByBridge() {
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
    elements.bluetoothStatus.textContent = '请先连接桥接服务。';
    return;
  }

  renderPreview();
  setProgress(0);

  const payload = get2BitPackedPayload();
  currentPacketId = `packet-${Date.now()}`;
  const message = {
    type: 'send_frame',
    packet_id: currentPacketId,
    device_address: elements.deviceAddress.value.trim(),
    characteristic_uuid: elements.characteristicUuid.value.trim(),
    width: getCanvasSize().width,
    height: getCanvasSize().height,
    encoding: '2bit-packed',
    chunk_size: Number(elements.chunkSize.value),
    chunk_delay_ms: Number(elements.chunkDelay.value),
    ack_every_chunks: Number(elements.ackEveryChunks.value),
    ack_characteristic_uuid: elements.ackCharacteristicUuid.value.trim(),
    ack_expected_hex: elements.ackExpectedHex.value.trim(),
    max_retries: Number(elements.maxRetries.value),
    data_base64: uint8ToBase64(payload)
  };

  bridgeSocket.send(JSON.stringify(message));
  elements.bluetoothStatus.textContent = `发送任务已开始：${payload.length} 字节。`;
}

function downloadSvg() {
  if (!latestSvgText) {
    renderPreview();
  }

  const blob = new Blob([latestSvgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const { width, height } = getCanvasSize();
  const link = document.createElement('a');
  link.href = url;
  link.download = `eink-${width}x${height}.svg`;
  link.click();
  URL.revokeObjectURL(url);
}

function applyOnlineFont() {
  currentFontFamily = elements.onlineFont.value;
  elements.fontStatus.textContent = `当前字体：${currentFontFamily}（在线）`;
  renderPreview();
}

function applyUploadedFont() {
  const file = elements.fontFile.files[0];
  if (!file) {
    return;
  }

  const familyName = file.name.replace(/\.[^.]+$/, '');
  const source = URL.createObjectURL(file);
  const fontFace = new FontFace(familyName, `url(${source})`);

  fontFace
    .load()
    .then((loadedFace) => {
      document.fonts.add(loadedFace);
      currentFontFamily = familyName;
      elements.fontStatus.textContent = `当前字体：${familyName}（上传）`;
      renderPreview();
    })
    .then(() => {
      URL.revokeObjectURL(source);
    });
}

elements.previewBtn.addEventListener('click', renderPreview);
elements.exportBtn.addEventListener('click', downloadSvg);
elements.useOnlineFont.addEventListener('click', applyOnlineFont);
elements.fontFile.addEventListener('change', applyUploadedFont);
elements.connectBridgeBtn.addEventListener('click', connectBridge);
elements.sendBridgeBtn.addEventListener('click', sendByBridge);

setBluetoothHint();
setProgress(0);
renderPreview();
