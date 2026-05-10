const { Transform } = require('stream');

class JitterBufferStream extends Transform {
    constructor(options = {}) {
        super(options);
        // Default buffer size before starting to emit.
        // 24000 Hz * 2 bytes/sample * 1 channel = 48000 bytes/sec.
        // 0.5 seconds buffer = 24000 bytes. Let's use roughly 32KB as default.
        this.bufferThreshold = options.bufferThreshold || 32768;
        this.chunks = [];
        this.currentSize = 0;
        this.isBuffering = true;
    }

    _transform(chunk, encoding, callback) {
        if (this.isBuffering) {
            this.chunks.push(chunk);
            this.currentSize += chunk.length;

            if (this.currentSize >= this.bufferThreshold) {
                console.log(`[JitterBuffer] 버퍼링 완료 (${this.currentSize} bytes). 재생을 시작합니다.`);
                this.isBuffering = false;

                // 버퍼링된 청크들 한 번에 내보냄
                while (this.chunks.length > 0) {
                    this.push(this.chunks.shift());
                }
            }
        } else {
            // 버퍼링 끝난 이후는 바로 통과
            this.push(chunk);
        }
        callback();
    }

    _flush(callback) {
        // 스트림이 끝나기 직전에 남아 있는 것들이 있으면 다 내보냄
        while (this.chunks.length > 0) {
            this.push(this.chunks.shift());
        }
        callback();
    }
}

module.exports = JitterBufferStream;
