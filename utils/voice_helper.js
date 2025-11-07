const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const prism = require('prism-media');
const { Readable } = require('stream'); // PassThrough는 ai_helper로 이동
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Interaction } = require('./database');
const { getTranscript, getLiveAiAudioResponse, generateMongoFilter } = require('./ai_helper');
const { spawn } = require('child_process'); // spawn 추가

// (AUDIO_CONFIG는 이전과 동일)
const AUDIO_CONFIG = {
    DISCORD_SAMPLE_RATE: 48000,
    AI_SAMPLE_RATE: 16000,
    AI_OUTPUT_SAMPLE_RATE: 24000,
    CHANNELS: 1,
    FRAME_SIZE: 960,
    FORMAT: 's16le'
};

class VoiceManager {
    constructor(channel) {
        this.channel = channel;
        this.connection = null;
        this.player = createAudioPlayer();
        this.activeSession = null;
        ffmpeg.setFfmpegPath(ffmpegStatic);

        this.#setupPlayerListeners();
        console.log(`[디버그] VoiceManager 인스턴스가 채널 '${channel.name}'에 대해 생성되었습니다.`);
    }

    async join() {
        if (this.connection) return;
        try {
            console.log(`[디버그] 채널 '${this.channel.name}'에 참가를 시도합니다...`);
            this.connection = joinVoiceChannel({
                channelId: this.channel.id,
                guildId: this.channel.guild.id,
                adapterCreator: this.channel.guild.voiceAdapterCreator,
                selfDeaf: false,
            });
            this.connection.subscribe(this.player);
            this.#startListening();
            console.log(`[디버그] ✅ 음성 채널 [${this.channel.name}]에 성공적으로 참가했습니다.`);
        } catch (error) {
            console.error("[디버그] ❌ 음성 채널 참가 중 심각한 오류 발생:", error);
        }
    }

    destroy() {
        if (!this.connection) return;
        console.log(`[디버그] 채널 '${this.channel.name}'에서 퇴장을 시작합니다.`);
        this.connection.destroy();
        this.connection = null;
        this.#endSession();
        console.log(`[디버그] ✅ 음성 채널 [${this.channel.name}]에서 성공적으로 퇴장했습니다.`);
    }

    #setupPlayerListeners() {
        this.player.on('stateChange', (oldState, newState) => {
            console.log(`[디버그] 오디오 플레이어 상태 변경: ${oldState.status} -> ${newState.status}`);
            if (newState.status === AudioPlayerStatus.Idle && oldState.status !== AudioPlayerStatus.Idle) {
                console.log('[디버그] 봇의 TTS 재생이 완료되어 세션을 종료합니다.');
                this.#endSession();
            }
        });
        this.player.on('error', error => {
            console.error('[디버그] ❌ 오디오 플레이어에서 오류 발생:', error);
            console.log('[디버그] 플레이어 오류로 인해 세션을 강제 종료합니다.');
            this.#endSession();
        });
    }
    
    #startListening() {
        console.log('[디버그] 유저 발화 감지(speaking) 리스너를 활성화합니다.');
        this.connection.receiver.speaking.on('start', (userId) => {
            if (this.activeSession) {
                console.log(`[디버그] [${userId}]님이 말을 시작했지만, 이미 다른 세션이 진행 중이라 무시합니다.`);
                return;
            }
            this.activeSession = { 
                userId, 
                liveSession: null, 
                streams: null, 
                smoothingBufferStream: null, // 버퍼 스트림
                ffmpegProcess: null, // FFmpeg 프로세스
                sessionReadyPromise: null
            };
            console.log(`[디버그] 🎤 [${userId}] 님의 발화가 감지되었습니다. 음성 처리 파이프라인을 시작합니다.`);
            this.#processUserSpeech(userId);
        });
    }
    
    async #processUserSpeech(userId) {
        let ffmpegProcess = null;
        let smoothingBufferStream = null;
        
        try {
            console.log(`[디버그] 1. [${userId}]님의 음성 스트림 처리를 시작합니다. (입력부 수정됨)`);
            const { opusStream, pcmStream, outputStream } = this.#recordUserAudio(userId);

            if (!outputStream) {
                console.error('[디버그] ❌ #recordUserAudio가 스트림을 반환하지 않아 파이프라인을 중단합니다.');
                this.#endSession();
                return;
            }
            
            this.activeSession.streams = { opusStream, pcmStream: null };

            // '말 끝남' 이벤트 리스너 (먼저 등록)
            outputStream.on('end', async () => {
                console.log(`[디버그] (voice_helper) FFmpeg(녹음) 스트림 종료 감지!`);
                
                if (!this.activeSession) {
                    console.warn('[디버그] (end event) 세션이 이미 종료되어 turnComplete를 보내지 않습니다.');
                    return;
                }

                try {
                    // ★ 2. AI 세션이 준비될 때까지 여기서 기다림 ★
                    console.log('[디버그] (end event) AI 세션이 준비되기를 기다립니다...');
                    await this.activeSession.sessionReadyPromise;
                    
                    // ★ 3. 세션이 준비되면 전송 ★
                    if (this.activeSession && this.activeSession.liveSession) {
                        console.log(`[디버그] ➡️ AI에게 'turnComplete: true' 신호를 전송합니다!`);
                        this.activeSession.liveSession.sendClientContent({ turnComplete: true });
                    } else {
                         console.error(`[디버그] ❌ AI 세션이 준비되었어야 하지만, 여전히 없습니다. turnComplete 전송 실패.`);
                    }
                } catch (err) {
                     console.error('[디버그] (end event) sessionReadyPromise 대기 중 오류:', err);
                }
            });

            console.log(`[디버그] 2. AI 응답 생성을 요청하고 "버퍼링"을 시작합니다...`);
            
            // "버퍼링" 방식 (await)
            const { aiTranscriptPromise, smoothingBufferStream: apiBuffer, sessionReadyPromise } = await this.#getAiResponse(userId, outputStream, this.activeSession);

            if (this.activeSession) { // 세션이 아직 살아있으면
                 this.activeSession.sessionReadyPromise = sessionReadyPromise;
            }
            
            smoothingBufferStream = apiBuffer; 
            this.activeSession.smoothingBufferStream = smoothingBufferStream; 

            console.log(`[디버그] 3. 버퍼링 완료. FFmpeg 변환기(-> Opus)에 "가득 찬 버퍼"를 연결합니다.`);

            // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
            //  여기가 "Opus"로 출력하도록 수정된 부분!
            // ★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★
            ffmpegProcess = spawn(ffmpegStatic, [
                '-hide_banner', '-loglevel', 'error',
                // 입력 옵션
                '-f', 's16le', '-ac', '1', '-ar', '24000', 
                '-i', 'pipe:0',
                
                // 출력 옵션 (Opus로 바로 인코딩)
                '-af', 'aresample=48000',      // 1. 48kHz로 리샘플링
                '-ac', '2',                     // 2. 2채널(스테레오)로
                '-c:a', 'libopus',              // 3. 'libopus' 코덱 사용 ★
                '-b:a', '128k',                 // 4. 비트레이트 128k (고음질)
                '-f', 'opus',                   // 5. 포맷을 Opus로 지정 ★
                'pipe:1'
            ], { 
                stdio: ['pipe', 'pipe', 'pipe'] 
            });
            
            this.activeSession.ffmpegProcess = ffmpegProcess;

            // (FFmpeg 에러 로깅은 그대로)
            ffmpegProcess.stderr.on('data', (data) => {
                console.error(`[FFmpeg (재생) STDERR]: ${data.toString()}`);
            });
            ffmpegProcess.on('error', (err) => {
                console.error('[FFmpeg (재생) SPAWN ERROR]:', err);
            });
            ffmpegProcess.on('close', (code) => {
                console.log(`[FFmpeg (재생) CLOSE]: 프로세스가 코드 ${code}로 종료되었습니다.`);
            });

            smoothingBufferStream.pipe(ffmpegProcess.stdin);
            
            // ★★★ AudioResource 타입을 .Raw가 아닌 .Opus로 변경! ★★★
            const resource = createAudioResource(ffmpegProcess.stdout, { 
                inputType: StreamType.Opus // 👈 여기가 바뀜!
            });
            
            console.log('[디버그] -> 재생: Opus 리소스를 생성하여 플레이어에서 재생을 *시작*합니다.');
            this.player.play(resource);

            const aiTranscript = await aiTranscriptPromise;

            console.log(`[디버그] ✅ 4. AI 답변 텍스트 수신 완료 (전체 텍스트: "${aiTranscript}").`);
            
            const botResponseToSave = aiTranscript.trim() || `(AI가 오디오로 응답함)`;
            
            console.log(`[디버그] 5. 대화 내용을 DB에 저장합니다.`);
            await this.#saveInteraction(userId, "(User spoke)", botResponseToSave);

        } catch (error) {
            console.error(`[디버그] ❌ 음성 처리 파이프라인 전체 과정에서 오류 발생:`, error);
            this.#endSession();
        }
    }

    #recordUserAudio(userId) {
        console.log(`[디버그] -> 녹음: [${userId}]님의 오디오 스트림을 구독합니다.`);
        const opusStream = this.connection.receiver.subscribe(userId, { 
            end: { 
                behavior: EndBehaviorType.AfterSilence,
                duration: 1000 // 1초간 침묵
            }
        });

        const pcmStream = new prism.opus.Decoder({ 
            frameSize: AUDIO_CONFIG.FRAME_SIZE, 
            channels: AUDIO_CONFIG.CHANNELS, 
            rate: AUDIO_CONFIG.DISCORD_SAMPLE_RATE 
        });

        opusStream.pipe(pcmStream);

        console.log('[디버그] -> 녹음: FFmpeg (Opus -> 16kHz PCM) 프로세스를 시작합니다.');
        const ffmpegProcess = ffmpeg(pcmStream)
            .inputFormat(AUDIO_CONFIG.FORMAT)
            .inputOptions([`-ar ${AUDIO_CONFIG.DISCORD_SAMPLE_RATE}`, `-ac ${AUDIO_CONFIG.CHANNELS}`])
            .addOption('-fflags', '+nobuffer')
            .outputFormat(AUDIO_CONFIG.FORMAT)
            .outputOptions([`-ar ${AUDIO_CONFIG.AI_SAMPLE_RATE}`]) // AI가 요구하는 16kHz
            .on('start', cmd => console.log(`[디버그] -> 녹음: (fluent-ffmpeg) 리샘플링 프로세스 시작.`))
            .on('error', err => {
                console.error('[디버그] ❌ -> 녹음: (fluent-ffmpeg) 오류 발생:', err);
                opusStream.destroy(err);
            });

        opusStream.on('end', () => {
            console.log(`[디버그] -> 녹음: Opus 스트림 종료. pcmStream 종료를 알립니다.`);
            pcmStream.end();
        });

        return { 
            opusStream, 
            pcmStream, // pcmStream도 리소스 정리해야 하니 반환
            outputStream: ffmpegProcess.stream() // 16kHz PCM 스트림
        };
    }

    async #getAiResponse(userId, userAudioStream, activeSession) {
        // (기억 검색 로직은 일단 그대로 둠)
        let systemPrompt = `You are a friendly and helpful AI assistant. Respond in Korean.`;
        
        console.log(`[디버그] -> AI 응답: 최종 프롬프트와 오디오 스트림으로 Gemini Live API를 호출합니다.`);
        
        // aiAudioStream 인자를 넘기지 않고, 반환값을 그대로 리턴
        return getLiveAiAudioResponse(systemPrompt, userAudioStream, activeSession);
    }
    
    async #searchMemories(transcript, userId) {
        try {
            const filter = await generateMongoFilter(transcript, userId, this.channel.client);
            const results = await Interaction.find(filter).limit(3);
            if (results.length > 0) console.log(`DB에서 ${results.length}개의 관련 기억을 찾았습니다.`);
            return results;
        } catch (e) {
            console.error("기억 검색 실패:", e);
            return [];
        }
    }

    async #saveInteraction(userId, userTranscript, aiTranscript) {
        if (!aiTranscript) return;
        try {
            const user = await this.channel.client.users.fetch(userId);
            const newInteraction = new Interaction({
                interactionId: `${userId}-${Date.now()}`,
                channelId: this.channel.id,
                userId,
                userName: user.username,
                type: 'VOICE',
                content: userTranscript,
                botResponse: aiTranscript
            });
            await newInteraction.save();
            console.log(`음성 대화를 DB에 저장했습니다.`);
        } catch (error) {
            console.error("DB 저장 실패:", error);
        }
    }

    #endSession() {
        if (!this.activeSession) return;
        console.log(`[디버그] 🌀 [${this.activeSession.userId}]님과의 활성 음성 세션을 종료합니다.`);
        const session = this.activeSession; // 복사
        this.activeSession = null; // 즉시 세션 비활성화 (중복 호출 방지)

        // 1. 녹음 스트림 정리 (기존 코드)
        if (session.streams) {
            if (session.streams.opusStream) {
                console.log('[디버그] -> 세션 종료: Opus 스트림(녹음)을 파괴합니다.');
                session.streams.opusStream.destroy();
            }
            if (session.streams.pcmStream) { // 👈 ★★★ 이거 추가 ★★★
                 console.log('[디버그] -> 세션 종료: PCM 스트림(녹음)을 파괴합니다.');
                session.streams.pcmStream.destroy();
            }
        }

        // 2. Gemini Live API 연결 종료 (기존 코드)
        if (session.liveSession) {
            console.log('[디버그] -> 세션 종료: Gemini Live API 연결을 닫습니다.');
            session.liveSession.close();
        }

        // 3. ★★★ 추가: 완충 버퍼 스트림 파괴 [cite: 159]
        if (session.smoothingBufferStream && !session.smoothingBufferStream.destroyed) {
            console.log('[디버그] -> 세션 종료: 완충 버퍼(PassThrough) 스트림을 파괴합니다.');
            session.smoothingBufferStream.destroy();
        }

        // 4. ★★★ 추가: FFmpeg 좀비 프로세스 방지 [cite: 157, 159]
        if (session.ffmpegProcess && !session.ffmpegProcess.killed) {
            console.log('[디버그] -> 세션 종료: FFmpeg 프로세스(PID: ' + session.ffmpegProcess.pid + ')를 강제 종료합니다.');
            session.ffmpegProcess.kill('SIGTERM');
        }
    }
}

module.exports = VoiceManager;