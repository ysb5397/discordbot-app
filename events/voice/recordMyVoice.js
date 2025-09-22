const { Events } = require('discord.js');
const { getVoiceConnection, EndBehaviorType } = require('@discordjs/voice');
const fs = require('fs');
const prism = require('prism-media');

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (message.author.bot || message.content !== '!녹음시작') return;

        const connection = getVoiceConnection(message.guild.id);

        if (!connection) {
            return message.reply('내가 음성 채널에 먼저 들어가 있어야 해! 😥');
        }

        if (message.member.voice.channel?.id !== connection.joinConfig.channelId) {
            return message.reply('나랑 같은 음성 채널에 있어야 녹음할 수 있어!');
        }

        await message.reply('좋아! 지금부터 네 목소리를 녹음할게. 말을 멈추면 자동으로 저장될 거야.');

        const receiver = connection.receiver;
        const audioStream = receiver.subscribe(message.author.id, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 1000,
            },
        });

        const pcmStream = new prism.opus.Decoder({ frameSize: 960, channels: 1, rate: 48000 });
        const writeStream = fs.createWriteStream(`output_${message.author.id}.pcm`);
        
        audioStream.pipe(pcmStream).pipe(writeStream);

        writeStream.on('finish', async () => { // async 키워드 추가!
            const filePath = `output_${message.author.id}.pcm`;
            
            // 기존의 텍스트 응답 대신, 파일을 직접 전송!
            try {
                await message.reply({
                    content: "녹음이 끝났어! 🎙️",
                    files: [filePath] // 파일 경로를 배열에 담아 전달
                });
            } catch (error) {
                console.error("파일 전송 중 오류 발생:", error);
                message.reply("파일을 전송하는 데 실패했어... 😢 (파일 첨부 권한이 없는지 확인해봐!)");
            }
        });
    },
};