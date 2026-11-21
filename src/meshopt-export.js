import { MeshoptEncoder } from 'meshoptimizer/meshopt_encoder.module.js';

const COMPONENT_BYTES = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

function align4(value) {
  return (value + 3) & ~3;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('Expected an ArrayBuffer or Uint8Array');
}

function readGlb(bytes) {
  if (bytes.byteLength < 20) throw new Error('Not a GLB file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  let offset = 20 + jsonLength;
  let bin = new Uint8Array(0);

  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x004e4942) {
      bin = bytes.subarray(offset + 8, offset + 8 + length);
    }
    offset += 8 + length;
  }

  return { json, bin };
}

function buildGlb(json, bin) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(align4(jsonBytes.length));
  jsonPadded.fill(0x20);
  jsonPadded.set(jsonBytes);

  const binPadded = new Uint8Array(align4(bin.length));
  binPadded.set(bin);

  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonPadded, 20);
  const binHeader = 20 + jsonPadded.length;
  view.setUint32(binHeader, binPadded.length, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  out.set(binPadded, binHeader + 8);
  return out;
}

function readIndices(bytes, componentType, count) {
  const out = new Uint32Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (componentType === 5125) {
    for (let i = 0; i < count; i++) out[i] = view.getUint32(i * 4, true);
  } else if (componentType === 5123) {
    for (let i = 0; i < count; i++) out[i] = view.getUint16(i * 2, true);
  } else {
    for (let i = 0; i < count; i++) out[i] = view.getUint8(i);
  }
  return out;
}

export async function compressGLB(input, onProgress) {
  await MeshoptEncoder.ready;
  const bytes = toBytes(input);
  const { json, bin } = readGlb(bytes);
  const totalViews = json.bufferViews ? json.bufferViews.length : 0;
  if (!json.buffers || json.buffers.length !== 1 || !totalViews) {
    return { buffer: bytes, compressed: 0, total: 0, skipped: 0 };
  }
  if (!json.accessors || !json.meshes) {
    return { buffer: bytes, compressed: 0, total: 0, skipped: 0 };
  }

  const meshAccessors = new Set();
  const targets = new Map();
  const mark = (accessorIndex, mode) => {
    if (!Number.isInteger(accessorIndex)) return;
    meshAccessors.add(accessorIndex);
    const accessor = json.accessors[accessorIndex];
    if (!accessor || accessor.bufferView === undefined || accessor.bufferView === null) return;
    const current = targets.get(accessor.bufferView);
    if (!current) targets.set(accessor.bufferView, { mode, accessorIndex });
    else if (current.mode !== mode) targets.set(accessor.bufferView, null);
  };

  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives || []) {
      if (primitive.indices !== undefined) mark(primitive.indices, 'TRIANGLES');
      for (const accessorIndex of Object.values(primitive.attributes || {})) {
        mark(accessorIndex, 'ATTRIBUTES');
      }
    }
  }

  const allAccessorsByView = new Map();
  json.accessors.forEach((accessor, index) => {
    if (accessor.bufferView === undefined || accessor.bufferView === null) return;
    if (!allAccessorsByView.has(accessor.bufferView)) allAccessorsByView.set(accessor.bufferView, []);
    allAccessorsByView.get(accessor.bufferView).push(index);
  });

  const originalViews = json.bufferViews.map((view) => ({
    byteOffset: view.byteOffset || 0,
    byteLength: view.byteLength || 0,
  }));

  const compressed = new Map();
  const decompressed = new Map();
  let skipped = 0;

  for (const [viewIndex, target] of targets) {
    if (!target) {
      skipped++;
      continue;
    }
    const view = json.bufferViews[viewIndex];
    if (view.extensions && view.extensions.EXT_meshopt_compression) {
      skipped++;
      continue;
    }
    const accessorList = allAccessorsByView.get(viewIndex) || [];
    if (!accessorList.length || accessorList.some((index) => !meshAccessors.has(index))) {
      skipped++;
      continue;
    }
    if (accessorList.length > 1 && !view.byteStride) {
      skipped++;
      continue;
    }

    const accessor = json.accessors[target.accessorIndex];
    if (!accessor) {
      skipped++;
      continue;
    }
    const base = originalViews[viewIndex].byteOffset;
    let source;
    let count;
    let size;
    let stride;
    let decompressedLength;

    if (target.mode === 'TRIANGLES') {
      if (accessor.type !== 'SCALAR' || accessor.count % 3 !== 0) {
        skipped++;
        continue;
      }
      const componentBytes = COMPONENT_BYTES[accessor.componentType];
      if (!componentBytes) {
        skipped++;
        continue;
      }
      const start = base + (accessor.byteOffset || 0);
      const needed = accessor.count * componentBytes;
      if (start + needed > bin.byteLength) {
        skipped++;
        continue;
      }
      const indices = readIndices(bin.subarray(start, start + needed), accessor.componentType, accessor.count);
      source = new Uint8Array(indices.buffer);
      count = accessor.count;
      size = 4;
      stride = 0;
      decompressedLength = count * 4;
      accessor.componentType = 5125;
      accessor.byteOffset = 0;
    } else {
      const componentBytes = COMPONENT_BYTES[accessor.componentType];
      const components = TYPE_COMPONENTS[accessor.type];
      if (!componentBytes || !components) {
        skipped++;
        continue;
      }
      if (view.byteStride) {
        const viewStride = view.byteStride;
        if (viewStride % 4 !== 0 || viewStride > 256) {
          skipped++;
          continue;
        }
        count = accessor.count;
        size = viewStride;
        stride = viewStride;
        if (base + count * viewStride > bin.byteLength) {
          skipped++;
          continue;
        }
        source = bin.subarray(base, base + count * viewStride);
        decompressedLength = count * stride;
      } else {
        count = accessor.count;
        size = componentBytes * components;
        if (size % 4 !== 0) {
          skipped++;
          continue;
        }
        const start = base + (accessor.byteOffset || 0);
        if (start + count * size > bin.byteLength) {
          skipped++;
          continue;
        }
        source = bin.subarray(start, start + count * size);
        stride = 0;
        decompressedLength = count * size;
        accessor.byteOffset = 0;
      }
    }

    let encoded;
    try {
      encoded = MeshoptEncoder.encodeGltfBuffer(source, count, size, target.mode);
    } catch (error) {
      skipped++;
      continue;
    }
    if (!encoded || !encoded.length || encoded.length >= source.length) {
      skipped++;
      continue;
    }

    compressed.set(viewIndex, { encoded, mode: target.mode, count, stride });
    decompressed.set(viewIndex, decompressedLength);
  }

  if (!compressed.size) {
    return { buffer: bytes, compressed: 0, total: 0, skipped };
  }

  const parts = [];
  let offset = 0;
  for (let i = 0; i < json.bufferViews.length; i++) {
    const view = json.bufferViews[i];
    const original = originalViews[i];
    offset = align4(offset);

    if (compressed.has(i)) {
      const info = compressed.get(i);
      const data = info.encoded;
      const decompressedLength = decompressed.get(i);
      view.byteOffset = 0;
      view.byteLength = decompressedLength;
      const extension = {
        buffer: 0,
        byteOffset: offset,
        byteLength: data.length,
        count: info.count,
        mode: info.mode,
        filter: 'NONE',
      };
      if (info.mode === 'ATTRIBUTES') {
        if (info.stride > 0) {
          extension.byteStride = info.stride;
          view.byteStride = info.stride;
        } else {
          delete view.byteStride;
        }
      } else {
        delete view.byteStride;
      }
      view.extensions = view.extensions || {};
      view.extensions.EXT_meshopt_compression = extension;
      parts.push({ offset, data });
      offset += data.length;
    } else {
      const data = bin.subarray(original.byteOffset, original.byteOffset + original.byteLength);
      view.byteOffset = offset;
      view.byteLength = data.length;
      parts.push({ offset, data });
      offset += data.length;
    }
  }

  const newBin = new Uint8Array(align4(offset));
  for (const part of parts) newBin.set(part.data, part.offset);

  json.buffers[0].byteLength = newBin.length;
  if (json.buffers[0].uri) delete json.buffers[0].uri;
  json.extensionsUsed = json.extensionsUsed || [];
  if (!json.extensionsUsed.includes('EXT_meshopt_compression')) {
    json.extensionsUsed.push('EXT_meshopt_compression');
  }
  json.extensionsRequired = json.extensionsRequired || [];
  if (!json.extensionsRequired.includes('EXT_meshopt_compression')) {
    json.extensionsRequired.push('EXT_meshopt_compression');
  }

  if (onProgress) onProgress(compressed.size, targets.size);

  return {
    buffer: buildGlb(json, newBin),
    compressed: compressed.size,
    total: targets.size,
    skipped,
  };
}