function createGlb(json, binary = Buffer.alloc(0)) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const result = Buffer.alloc(12 + 8 + jsonLength + (binaryLength ? 8 + binaryLength : 0));
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(0x20, 20, 20 + jsonLength);
  jsonBytes.copy(result, 20);
  if (binaryLength) {
    result.writeUInt32LE(binaryLength, 20 + jsonLength);
    result.writeUInt32LE(0x004e4942, 24 + jsonLength);
    binary.copy(result, 28 + jsonLength);
  }
  return result;
}

function triangleDocument() {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.7, 0.4, 1], metallicFactor: 0 } }],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3',
      min: [-0.7, -0.6, 0], max: [0.7, 0.8, 0] }]
  };
}

function triangleBinary() {
  const binary = Buffer.alloc(36);
  [-0.7, -0.6, 0, 0.7, -0.6, 0, 0, 0.8, 0].forEach((number, index) => binary.writeFloatLE(number, index * 4));
  return binary;
}

function createTriangleGlb() {
  return createGlb(triangleDocument(), triangleBinary());
}

module.exports = { createGlb, createTriangleGlb, triangleDocument, triangleBinary };
