const { joinVoiceChannel, getVoiceConnection, EndBehaviorType, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const prism = require('prism-media');
const { Readable } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { Interaction } = require('./database');
const { getTranscript, getLiveAiAudioResponse, generateMongoFilter } = require('./ai_helper');

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
            this.activeSession = { userId, liveSession: null, streams: null, aiAudioStream: null };
            console.log(`[디버그] 🎤 [${userId}] 님의 발화가 감지되었습니다. 음성 처리 파이프라인을 시작합니다.`);
            this.#processUserSpeech(userId);
        });
    }
    
    async #processUserSpeech(userId) {
        let aiAudioStream;
        try {
            console.log(`[디버그] 1. [${userId}]님의 음성 스트림 처리를 시작합니다.`);
            const { opusStream, pcmStream, outputStream } = this.#recordUserAudio(userId);

            if (!outputStream) {
                console.error('[디버그] ❌ #recordUserAudio가 스트림을 반환하지 않아 파이프라인을 중단합니다. (아마도 너무 짧은 발화)');
                this.#endSession();
                return;
            }
            
            this.activeSession.streams = { opusStream, pcmStream };

            console.log(`[디버그] 2. AI 오디오 스트리밍 파이프라인을 설정합니다.`);
            aiAudioStream = new Readable({ read() {} });
            this.activeSession.aiAudioStream = aiAudioStream;

            const ffmpegOutput = ffmpeg(aiAudioStream)
                .inputFormat(AUDIO_CONFIG.FORMAT)
                .inputOptions([
                    `-ar ${AUDIO_CONFIG.AI_OUTPUT_SAMPLE_RATE}`, 
                    `-ac ${AUDIO_CONFIG.CHANNELS}`
                ])
                .addOption('-fflags', '+nobuffer')
                .outputFormat(AUDIO_CONFIG.FORMAT)
                .outputOptions([
                    `-ar ${AUDIO_CONFIG.DISCORD_SAMPLE_RATE}`,
                    `-ac 2`
                ])
                .on('start', cmd => console.log(`[디버그] -> 재생: (스트리밍) FFmpeg 재생 프로세스 시작.`))
                .on('error', err => console.error('[디버그] ❌ -> 재생: (스트리밍) FFmpeg 오류:', err))
                .stream();

            const resource = createAudioResource(ffmpegOutput, { inputType: StreamType.Raw });
            console.log('[디버그] -> 재생: 오디오 리소스를 생성하여 플레이어에서 재생을 *시작*합니다.');
            this.player.play(resource);

            console.log(`[디버그] 3. AI 답변 생성을 요청합니다.`);

            const aiResponsePromise = this.#getAiResponse(userId, outputStream, this.activeSession, aiAudioStream);

            outputStream.on('end', () => {
                console.log(`[디버그] (voice_helper) FFmpeg 스트림 종료 감지!`);
                
                // ai_helper가 session을 할당해 주길 기다림 (아주 잠깐)
                // 만약의 레이스 컨디션을 위해 1초 지연된 체크를 추가 (안전장치)
                if (this.activeSession && this.activeSession.liveSession) {
                    console.log(`[디버그] ➡️ AI에게 'turnComplete: true' 신호를 전송합니다!`);
                    this.activeSession.liveSession.sendClientContent({ turnComplete: true });
                } else {
                    console.warn(`[디버그] ⚠️ FFmpeg 스트림은 끝났지만, AI 세션이 (아직) 활성화되지 않았습니다. 1초 후 재시도...`);
                    setTimeout(() => {
                        if (this.activeSession && this.activeSession.liveSession) {
                            console.log(`[디버그] (1초 지연) ➡️ AI에게 'turnComplete: true' 신호를 전송합니다!`);
                            this.activeSession.liveSession.sendClientContent({ turnComplete: true });
                        } else {
                             console.error(`[디버그] ❌ (1초 지연) AI 세션이 여전히 없습니다. turnComplete 전송 실패.`);
                        }
                    }, 1000);
                }
            });
            
            const { aiTranscript } = await aiResponsePromise;
            console.log(`[디버그] ✅ 4. AI 답변 스트리밍 완료 (전체 텍스트: "${aiTranscript}").`);
            
            const botResponseToSave = aiTranscript.trim() || `(AI가 오디오로 응답함)`;
            
            console.log(`[디버그] 5. 대화 내용을 DB에 저장합니다.`);
            await this.#saveInteraction(userId, "(User spoke)", botResponseToSave);

        } catch (error) {
            console.error(`[디버그] ❌ 음성 처리 파이프라인 전체 과정에서 오류 발생:`, error);
            if (this.activeSession && this.activeSession.aiAudioStream && !this.activeSession.aiAudioStream.destroyed) {
                 this.activeSession.aiAudioStream.push(null);
            }
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

        const ffmpegProcess = ffmpeg(pcmStream)
            .inputFormat(AUDIO_CONFIG.FORMAT)
            .inputOptions([`-ar ${AUDIO_CONFIG.DISCORD_SAMPLE_RATE}`, `-ac ${AUDIO_CONFIG.CHANNELS}`])
            .addOption('-fflags', '+nobuffer')
            .outputFormat(AUDIO_CONFIG.FORMAT)
            .outputOptions([`-ar ${AUDIO_CONFIG.AI_SAMPLE_RATE}`])
            .on('start', cmd => console.log(`[디버그] -> 녹음: FFmpeg 리샘플링 프로세스 시작.`))
            .on('error', err => {
                console.error('[디버그] ❌ -> 녹음: FFmpeg 오류 발생:', err);
                opusStream.destroy(err);
            });
        
        opusStream.on('end', () => {
            console.log(`[디버그] -> 녹음: Opus 스트림 종료. pcmStream 종료를 알립니다.`);
            pcmStream.end();
        });

        return { 
            opusStream, 
            pcmStream, 
            outputStream: ffmpegProcess.stream() 
        };
    }

    async #getAiResponse(userId, userAudioStream, activeSession, aiAudioStream) {
        console.log(`[디버그] -> AI 응답: 최종 프롬프트와 오디오 스트림으로 Gemini Live API를 호출합니다.`);
        return getLiveAiAudioResponse(systemPrompt, userAudioStream, activeSession, aiAudioStream);
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

    #playAiAudio(audioBuffers) {
        const combinedBuffer = Buffer.concat(audioBuffers);
        const inputAudioStream = Readable.from(combinedBuffer);

        console.log(`[디버그] -> 재생: AI 오디오(버퍼 크기: ${combinedBuffer.length})를 Discord 샘플링 레이트로 변환합니다.`);
        const ffmpegOutput = ffmpeg(inputAudioStream)
            // ▼▼▼ 수정된 부분 ▼▼▼
            .inputFormat(AUDIO_CONFIG.FORMAT)
            .inputOptions([
                `-ar ${AUDIO_CONFIG.AI_OUTPUT_SAMPLE_RATE}`, 
                `-ac ${AUDIO_CONFIG.CHANNELS}` // AI 오디오는 1채널(모노)임을 명시
            ])
            .outputFormat(AUDIO_CONFIG.FORMAT)
            .outputOptions([
                `-ar ${AUDIO_CONFIG.DISCORD_SAMPLE_RATE}`,
                `-ac 2` // 디스코드 플레이어를 위해 2채널(스테레오)로 출력
            ])
            .on('start', cmd => console.log(`[디버그] -> 재생: FFmpeg 재생 프로세스 시작.`))
            .on('error', err => console.error('[디버그] ❌ -> 재생: FFmpeg 오류:', err))
            .stream();
            
        const resource = createAudioResource(ffmpegOutput, { inputType: StreamType.Raw });
        console.log('[디버그] -> 재생: 오디오 리소스를 생성하여 플레이어에서 재생합니다.');
        this.player.play(resource);
    }

    #endSession() {
        if (!this.activeSession) return;
        console.log(`[디버그] 🌀 [${this.activeSession.userId}]님과의 활성 음성 세션을 종료합니다.`);

        if (this.activeSession.streams && this.activeSession.streams.opusStream) {
            console.log('[디버그] -> 세션 종료: Opus 스트림을 파괴하여 녹음 파이프라인을 정리합니다.');
            this.activeSession.streams.opusStream.destroy();
            // opusStream.destroy()가 'end' 이벤트를 발생시켜서
            // pcmStream.end()가 자동으로 호출되므로 opusStream만 닫기
        }

        if (this.activeSession.liveSession) {
            console.log('[디버그] -> 세션 종료: Gemini Live API 연결을 닫습니다.');
            this.activeSession.liveSession.close();
        }
        this.activeSession = null;
    }
}

module.exports = VoiceManager;