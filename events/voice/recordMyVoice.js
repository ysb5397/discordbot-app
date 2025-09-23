const { Events } = require('discord.js');
const { getVoiceConnection, EndBehaviorType } = require('@discordjs/voice');
const fs = require('fs');
const prism = require('prism-media');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // 봇 자신의 메시지나, 명령어가 아니면 무시
        if (message.author.bot || message.content !== '!녹음시작') return;

        // 1. 음성 채널 연결 가져오기
        const connection = getVoiceConnection(message.guild.id);

        // 2. 봇이 음성 채널에 없거나, 사용자가 다른 채널에 있으면 에러 메시지 전송
        if (!connection) {
            return message.reply('내가 음성 채널에 먼저 들어가 있어야 해! 😥');
        }
        if (message.member.voice.channel?.id !== connection.joinConfig.channelId) {
            return message.reply('나랑 같은 음성 채널에 있어야 녹음할 수 있어!');
        }

        await message.reply('좋아! 지금부터 네 목소리를 녹음할게. 말을 멈추면 자동으로 저장될 거야.');

        // 3. 사용자의 음성을 수신할 스트림 생성
        const audioStream = connection.receiver.subscribe(message.author.id, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 1500, // 말을 멈추는 걸 감지하는 시간을 1.5초로 약간 늘렸어
            },
        });

        const pcmFilePath = `output_${message.author.id}.pcm`;
        const mp3FilePath = `output_${message.author.id}.mp3`;

        const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
        const writeStream = fs.createWriteStream(pcmFilePath);

        // 4. 오디오 스트림을 pcm 파일로 저장
        audioStream.pipe(pcmStream).pipe(writeStream);

        // 5. pcm 파일 저장이 완료되면 실행
        writeStream.on('finish', () => {
            // ffmpeg에게 실행 파일 경로 설정
            ffmpeg.setFfmpegPath(ffmpegStatic);

            // ffmpeg 변환 시작!
            ffmpeg(pcmFilePath)
                .inputFormat('s16le')
                .audioFrequency(48000)
                .audioChannels(1)
                .toFormat('mp3')
                .on('end', async () => {
                    // 6. mp3 변환이 끝나면 디스코드로 파일 전송
                    console.log('MP3 파일 변환 성공!');
                    try {
                        await message.reply({
                            content: "녹음이 끝났어! 🎙️",
                            files: [mp3FilePath]
                        });
                    } catch (error) {
                        console.error("파일 전송 중 오류 발생:", error);
                        message.reply("파일을 전송하는 데 실패했어... 😢");
                    } finally {
                        // 7. (개선) 전송 후 임시 파일들 삭제
                        fs.unlinkSync(pcmFilePath);
                        fs.unlinkSync(mp3FilePath);
                    }
                })
                .on('error', (err) => {
                    console.error('파일 변환 중 오류:', err);
                    message.reply('음성 파일을 변환하는 데 실패했어...');
                    // 에러가 나도 임시 파일은 삭제
                    fs.unlinkSync(pcmFilePath);
                })
                .save(mp3FilePath);
        });
    },
};
