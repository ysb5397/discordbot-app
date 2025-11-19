const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const prism = require('prism-media');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Interaction } = require('./database');
const { getTranscript, getLiveAiAudioResponse, generateMongoFilter } = require('./ai_helper');
const { spawn } = require('child_process');
const config = require('../config/manage_environments.js');

// [NEW] config에서 값 가져오기 (없으면 기본값 48000)
const AUDIO_CONFIG = {
    DISCORD_SAMPLE_RATE: 48000,
    AI_SAMPLE_RATE: 16000,
    AI_OUTPUT_SAMPLE_RATE: 24000,
    CHANNELS: 1,
    FRAME_SIZE: 960,
    FORMAT: 's16le'
};

class GeminiVoiceManager {
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
        this.#endSession(true);
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
            this.#endSession(true);
        });
    }
    
    #startListening() {
        console.log('[디버그] 유저 발화 감지(speaking) 리스너를 활성화합니다.');
        if (!this.connection || !this.connection.receiver) {
             console.warn('[디버그] connection 또는 receiver가 없어 리스닝을 시작할 수 없습니다.');
             return;
        }

        this.connection.receiver.speaking.on('start', (userId) => {
            if (this.activeSession) {
                console.log(`[디버그] [${userId}]님이 말을 시작했지만, 이미 다른 세션이 진행 중이라 무시합니다.`);
                return;
            }
            this.activeSession = { 
                userId, 
                liveSession: null, 
                streams: null, 
                smoothingBufferStream: null,
                ffmpegProcess: null,
                aiAudioStream: null,
                sessionReadyPromise: null
            };
            console.log(`[디버그] 🎤 [${userId}] 님의 발화가 감지되었습니다. 음성 처리 파이프라인을 시작합니다.`);
            this.#processUserSpeech(userId);
        });
    }
    
    async #processUserSpeech(userId) {
        let ffmpegProcess = null;
        let smoothingBufferStream = null;
        let aiAudioStream = null;

        try {
            console.log(`[디버그] 1. [${userId}]님의 음성 스트림 처리를 시작합니다.`);
            const { opusStream, pcmStream, outputStream } = this.#recordUserAudio(userId);

            if (!outputStream) {
                console.error('[디버그] ❌ #recordUserAudio가 스트림을 반환하지 않아 파이프라인을 중단합니다. (아마도 너무 짧은 발화)');
                this.#endSession(true);
                return;
            }
            
            if (this.activeSession) {
                this.activeSession.streams = { opusStream, pcmStream };
            }

            outputStream.on('end', async () => {
                console.log(`[디버그] (voice_helper) 녹음(FFmpeg) 스트림 종료 감지!`);
                
                if (!this.activeSession) {
                    console.warn('[디버그] 세션이 이미 종료되어 turnComplete를 보낼 수 없습니다.');
                    return;
                }

                try {
                    if (this.activeSession.sessionReadyPromise) {
                         console.log('[디버그] (end event) AI 세션 준비 대기 중...');
                         await this.activeSession.sessionReadyPromise;
                    }
                    
                    if (this.activeSession && this.activeSession.liveSession) {
                        console.log(`[디버그] ➡️ AI에게 'turnComplete: true' 신호를 전송합니다!`);
                        this.activeSession.liveSession.sendClientContent({ turnComplete: true });
                    } else {
                         console.warn(`[디버그] ⚠️ AI 세션이 준비되지 않아 turnComplete를 보내지 못했습니다.`);
                    }
                } catch (err) {
                     console.error('[디버그] (end event) 대기 중 오류:', err);
                }
            });

            console.log(`[디버그] 2. AI 응답 생성을 요청하고 "버퍼링"을 시작합니다...`);
            
            const { aiTranscriptPromise, smoothingBufferStream: apiBuffer, sessionReadyPromise } = await this.#getAiResponse(userId, outputStream, this.activeSession);

            if (this.activeSession) { 
                 this.activeSession.sessionReadyPromise = sessionReadyPromise;
                 this.activeSession.smoothingBufferStream = apiBuffer; 
            }
            smoothingBufferStream = apiBuffer;

            console.log(`[디버그] 3. 버퍼링 완료. FFmpeg 변환기(-> Opus)에 "가득 찬 버퍼"를 연결합니다.`);

            ffmpegProcess = spawn(ffmpegStatic, [
                '-hide_banner', '-loglevel', 'error', // 로그 레벨 조정 (verbose -> error)
                '-f', 's16le', '-ac', '1', '-ar', '24000', 
                '-i', 'pipe:0',
                '-af', 'aresample=48000',      // 1. 48kHz로 리샘플링
                '-ac', '2',                     // 2. 2채널(스테레오)로
                '-f', 's16le',                   // 3. 포맷을 Opus로 지정
                'pipe:1'
            ], { 
                stdio: ['pipe', 'pipe', 'pipe'] 
            });
            
            if (this.activeSession) {
                this.activeSession.ffmpegProcess = ffmpegProcess;
            }

            ffmpegProcess.on('exit', (code, signal) => {
                console.log(`[디버그] 재생용 FFmpeg 프로세스가 종료되었습니다 (Code: ${code}, Signal: ${signal})`);
            });

            ffmpegProcess.stdin.on('error', (err) => {
                if (err.code !== 'EPIPE') console.error('[디버그 LOG] ❌ FFmpeg stdin 오류:', err.message);
            });
            
            ffmpegProcess.stdout.on('error', (err) => {
                 console.error('[디버그 LOG] ❌ FFmpeg stdout 오류:', err.message);
            });

            smoothingBufferStream.on('error', (err) => {
                console.error('[디버그 LOG] ❌ smoothingBufferStream 오류:', err.message);
            });
            
            smoothingBufferStream.pipe(ffmpegProcess.stdin);
            
            const resource = createAudioResource(ffmpegProcess.stdout, { 
                inputType: StreamType.Raw
            });

            resource.playStream.on('error', (err) => {
                console.error(`[디버그 LOG] ❌ AudioResource 오류: ${err.message}`);
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
            this.#endSession(true);
        }
    }

    #recordUserAudio(userId) {
        console.log(`[디버그] -> 녹음: [${userId}]님의 오디오 스트림을 구독합니다.`);
        const opusStream = this.connection.receiver.subscribe(userId, { 
            end: { 
                behavior: EndBehaviorType.AfterSilence,
                duration: 1000
            }
        });
        
        const pcmStream = new prism.opus.Decoder({ 
            frameSize: AUDIO_CONFIG.FRAME_SIZE, 
            channels: AUDIO_CONFIG.CHANNELS, 
            rate: AUDIO_CONFIG.DISCORD_SAMPLE_RATE 
        });

        opusStream.pipe(pcmStream);

        const ffmpegProcess = ffmpeg(pcmStream)
            .inputFormat(AUDIO_CONFIG.FORMAT)
            .inputOptions([`-ar ${AUDIO_CONFIG.DISCORD_SAMPLE_RATE}`, `-ac ${AUDIO_CONFIG.CHANNELS}`])
            .addOption('-fflags', '+nobuffer')
            .outputFormat(AUDIO_CONFIG.FORMAT)
            .outputOptions([`-ar ${AUDIO_CONFIG.AI_SAMPLE_RATE}`])
            .on('start', cmd => console.log(`[디버그] -> 녹음: (fluent-ffmpeg) 리샘플링 프로세스 시작.`))
            .on('error', err => {
                if (!err.message.includes('SIGKILL')) {
                    console.error('[디버그] ❌ -> 녹음: FFmpeg 오류 발생:', err);
                }
            });
        
        opusStream.on('end', () => {
            console.log(`[디버그] -> 녹음: Opus 스트림 종료. pcmStream 종료를 알립니다.`);
            try { pcmStream.end(); } catch(e) {}
        });

        return { 
            opusStream, 
            pcmStream,
            outputStream: ffmpegProcess.stream()
        };
    }

    async #getAiResponse(userId, userAudioStream, activeSession) {
        let systemPrompt = `${config.ai.persona} 
        (추가 지침: 대답은 너무 길지 않게, 듣기 편한 구어체로 짧게 대답해줘.)`;
        console.log(`[디버그] -> AI 응답: 최종 프롬프트와 오디오 스트림으로 Gemini Live API를 호출합니다.`);
        return getLiveAiAudioResponse(systemPrompt, userAudioStream, activeSession);
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

    #endSession(force = false) {
        if (!this.activeSession) return;
        console.log(`[디버그] 🌀 [${this.activeSession.userId}]님과의 활성 음성 세션을 종료합니다. (Force: ${force})`);
        const session = this.activeSession;
        this.activeSession = null;

        if (session.streams) {
            if (session.streams.opusStream) {
                try { session.streams.opusStream.destroy(); } catch(e) {}
            }
            if (session.streams.pcmStream) {
                try { session.streams.pcmStream.destroy(); } catch(e) {}
            }
        }

        if (session.liveSession) {
            try { 
                console.log('[디버그] -> 세션 종료: Gemini Live API 연결을 닫습니다.');
                session.liveSession.close(); 
            } catch(e) { 
                console.error('[디버그] Live 세션 종료 중 오류:', e); 
            }
        }

        if (session.smoothingBufferStream && !session.smoothingBufferStream.destroyed) {
            try { session.smoothingBufferStream.destroy(); } catch(e) {}
        }

        if (session.ffmpegProcess) {
             if (force) {
                if (!session.ffmpegProcess.killed) {
                    console.log(`[디버그] -> 세션 종료 (강제): 재생용 FFmpeg(PID: ${session.ffmpegProcess.pid})를 확인 사살(SIGKILL)합니다.`);
                    session.ffmpegProcess.kill('SIGKILL'); 
                }
             } else {
                 setTimeout(() => {
                     if (!session.ffmpegProcess.killed) {
                         console.log(`[디버그] -> 세션 종료 (타임아웃): 재생용 FFmpeg(PID: ${session.ffmpegProcess.pid})를 강제 종료합니다.`);
                         session.ffmpegProcess.kill('SIGKILL');
                     }
                 }, 2000);
             }
        }
    }
}

module.exports = GeminiVoiceManager;