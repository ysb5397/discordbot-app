const ytSearch = require('yt-search');
const youtubedl = require('youtube-dl-exec');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    StreamType
} = require('@discordjs/voice');

class YoutubeManager {
    constructor(voiceChannel) {
        this.channel = voiceChannel;
        this.connection = null;
        this.player = createAudioPlayer();
        this.queue = [];
        this.isQueuePlaying = false;

        console.log(`[YouTube] '${voiceChannel.name}' 채널 매니저 생성됨`);

        this.#setupPlayerListeners();
    }

    async join() {
        try {
            this.connection = joinVoiceChannel({
                channelId: this.channel.id,
                guildId: this.channel.guild.id,
                adapterCreator: this.channel.guild.voiceAdapterCreator,
            });

            this.connection.subscribe(this.player);
            console.log(`[YouTube] 채널 '${this.channel.name}'에 성공적으로 입장함.`);

            this.connection.on(VoiceConnectionStatus.Ready, () => {
                console.log(`[YouTube] 음성 연결 준비 완료!`);
            });

            this.connection.on(VoiceConnectionStatus.Disconnected, () => {
                console.warn(`[YouTube] 음성 연결 끊어짐!`);
                this.destroy();
            });

        } catch (error) {
            console.error(`[YouTube] ❌ 채널 참가 중 오류:`, error);
        }
    }

    #setupPlayerListeners() {
        this.player.on(AudioPlayerStatus.Playing, () => {
            console.log('[YouTube] 재생 시작됨');
            this.isQueuePlaying = true;
        });

        this.player.on(AudioPlayerStatus.Idle, () => {
            console.log('[YouTube] 플레이어 상태: Idle');
            this.isQueuePlaying = false;
            this._playNextSongInQueue();
        });

        this.player.on('error', error => {
            console.error('[YouTube] ❌ 오디오 플레이어 오류:', error.message);
            this.isQueuePlaying = false;
            this._playNextSongInQueue();
        });
    }

    async _playNextSongInQueue() {
        if (this.queue.length === 0) {
            console.log('[YouTube] 큐가 비어있어 대기합니다.');
            return;
        }

        const nextSong = this.queue.shift();
        console.log(`[YouTube] 다음 곡 재생 시도: ${nextSong.title}`);

        try {
            const info = await youtubedl(nextSong.url, {
                dumpSingleJson: true,
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                youtubeSkipDashManifest: true,
            });

            const audioUrl = info.url;
            if (!audioUrl || !audioUrl.startsWith('http')) {
                throw new Error('유효한 오디오 URL을 찾을 수 없습니다.');
            }

            const resource = createAudioResource(audioUrl, {
                inputType: StreamType.Arbitrary,
            });

            this.player.play(resource);

        } catch (error) {
            console.error(`[YouTube] ❌ '${nextSong.title}' 재생 중 오류:`, error.message);
            this.isQueuePlaying = false;
            this._playNextSongInQueue();
        }
    }

    async play(query) {
        if (!this.connection) {
            console.warn('[YouTube] 아직 음성 채널에 연결되지 않았습니다.');
            return null;
        }

        const video = await this.searchVideo(query);

        if (!video) {
            console.log(`[YouTube] ❌ 검색 결과 없음: ${query}`);
            return null;
        }

        const song = {
            title: video.title,
            url: video.url,
            duration: video.timestamp
        };

        this.queue.push(song);
        console.log(`[YouTube] 큐 추가됨: ${song.title}`);

        // ❗ 현재 재생 중이 아닐 때만 다음 곡 재생 시도
        if (!this.isQueuePlaying) {
            this._playNextSongInQueue();
        }

        return song;
    }

    async searchVideo(query) {
        try {
            console.log(`[YouTube] yt-search로 '${query}' 검색 시도...`);
            const result = await ytSearch(query);

            if (!result || result.videos.length === 0) {
                console.warn(`[YouTube] ❌ 검색 결과 없음.`);
                return null;
            }

            const video = result.videos[0];
            console.log(`[YouTube] 검색 결과: ${video.title}`);

            return {
                title: video.title,
                url: video.url,
                timestamp: video.timestamp
            };

        } catch (error) {
            console.error(`[YouTube] ❌ yt-search 오류:`, error.message);
            return null;
        }
    }

    skip() {
        if (!this.isQueuePlaying) {
            console.log('[YouTube] 스킵할 곡이 없습니다.');
            return false;
        }
        console.log('[YouTube] 현재 곡을 스킵합니다...');
        this.player.stop(true);
        return true;
    }

    stop() {
        console.log('[YouTube] 모든 작업을 중지합니다.');
        this.queue = [];
        this.isQueuePlaying = false;
        if (this.player) {
            this.player.stop(true);
        }
    }

    destroy() {
        console.log(`[YouTube] 채널 '${this.channel.name}'에서 퇴장 및 정리 작업 시작...`);
        this.stop();

        if (this.player) {
            this.player.removeAllListeners();
        }

        if (this.connection) {
            if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
                this.connection.destroy();
            }
            this.connection = null;
        }

        console.log(`[YouTube] 매니저 정리 완료.`);
    }
}

module.exports = YoutubeManager;
