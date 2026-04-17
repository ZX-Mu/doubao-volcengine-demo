/**
 * Utility functions for Volcengine Speech SDK protocols (v3)
 *
 * Protocol header layout (4 bytes base):
 *   Byte 0: protocol version (4 bits) | header size in 4-byte units (4 bits)
 *   Byte 1: message type (4 bits)     | message flags (4 bits)
 *   Byte 2: serialization (4 bits)    | compression (4 bits)
 *   Byte 3: reserved (0x00)
 *   [optional Bytes 4-7]: sequence number (Int32BE), present when flags bit0 = 1
 *
 * Message types:
 *   0x1 = Full Client Request (JSON handshake)
 *   0x2 = Audio Only Request
 *   0x9 = Full Server Response
 *   0xf = Error Message
 *
 * Message flags:
 *   0x0 = no flags
 *   0x1 = sequence number follows
 *   0x2 = last packet (FIN)
 *   0x3 = sequence number + last packet
 *
 * Serialization:
 *   0x1 = JSON
 *
 * Compression:
 *   0x0 = none
 *   0x1 = gzip
 */

export interface VolcHeader {
    version: number;
    headerSize: number;   // actual byte count
    messageType: number;
    messageFlags: number;
    serialization: number;
    compression: number;
    sequenceNumber?: number;
}

/**
 * Build a v3 binary header for a client → server frame.
 *
 * @param messageType   0x1 = JSON handshake, 0x2 = audio data
 * @param messageFlags  0x0 = normal, 0x2 = FIN (last audio packet)
 * @param serialization 0x1 = JSON (only relevant for type 0x1)
 * @param compression   0x0 = none
 * @param sequenceNumber optional Int32; if provided, flags bit0 is set and 4 extra bytes are added
 */
export function constructHeader(
    messageType: number,
    messageFlags: number,
    serialization: number,
    compression: number,
    sequenceNumber?: number
): Uint8Array {
    const hasSeq = sequenceNumber !== undefined;
    const headerByteLen = hasSeq ? 8 : 4;
    const headerSizeField = headerByteLen / 4; // stored as units of 4 bytes

    const flags = hasSeq ? (messageFlags | 0x1) : messageFlags;

    const header = new Uint8Array(headerByteLen);
    header[0] = (0x1 << 4) | headerSizeField;           // version=1, header size
    header[1] = (messageType << 4) | flags;
    header[2] = (serialization << 4) | (compression & 0x0F);
    header[3] = 0x00;

    if (hasSeq) {
        const view = new DataView(header.buffer);
        view.setInt32(4, sequenceNumber!, false);
    }

    return header;
}

/**
 * Parse a v3 response header from a received ArrayBuffer.
 * Returns null if the buffer is too short.
 */
export function parseHeader(buffer: ArrayBuffer): VolcHeader | null {
    if (buffer.byteLength < 4) return null;
    const view = new DataView(buffer);

    const b0 = view.getUint8(0);
    const version = b0 >> 4;
    const headerSizeUnits = b0 & 0x0F;
    const headerSize = headerSizeUnits * 4;

    const b1 = view.getUint8(1);
    const messageType = b1 >> 4;
    const messageFlags = b1 & 0x0F;

    const b2 = view.getUint8(2);
    const serialization = b2 >> 4;
    const compression = b2 & 0x0F;

    let sequenceNumber: number | undefined;
    if ((messageFlags & 0x1) && buffer.byteLength >= 8) {
        sequenceNumber = view.getInt32(4, false);
    }

    return { version, headerSize, messageType, messageFlags, serialization, compression, sequenceNumber };
}

/**
 * Generates a random UUID-like request ID.
 */
export function generateReqId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
