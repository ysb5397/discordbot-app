const { Client, GatewayIntentBits, VoiceChannel } = require('discord.js');
// getVoiceConnection을 추가로 import 해야 해!
const { joinVoiceChannel, getVoiceConnection, VoiceReceiver, EndBehaviorType } = require('@discordjs/voice');
const fs = require('fs');
const prism = require('prism-media');

// --- 설정 부분 (이전과 동일) ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
// ----------------

client.on('messageCreate', async message => {
    console.log(`[메시지 수신] 보낸 사람: ${message.author.tag}, 내용: "${message.content}"`);
    if (message.author.bot) return;

    if (message.content === '!녹음시작') {
        // 1. 봇이 현재 서버의 음성 채널에 연결되어 있는지 확인
        const connection = getVoiceConnection(message.guild.id);
        
        // 1-1. 봇이 음성 채널에 없는 경우
        if (!connection) {
            message.reply('내가 음성 채널에 먼저 들어가 있어야 해! 😥');
            return;
        }

        // 1-2. 명령어를 친 사용자가 봇과 같은 음성 채널에 있는지 확인
        if (message.member.voice.channel?.id !== connection.joinConfig.channelId) {
            message.reply('나랑 같은 음성 채널에 있어야 녹음할 수 있어!');
            return;
        }

        message.reply('좋아! 지금부터 네 목소리를 녹음할게. 말을 멈추면 자동으로 저장될 거야.');

        // 2. 특정 사용자의 음성 데이터 수신 시작 (이 부분은 이전 코드와 동일)
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

        writeStream.on('finish', () => {
             message.reply(`녹음이 끝났어! 'output_${message.author.id}.pcm' 파일이 생성됐을 거야.`);
        });
    }
});

client.login(BOT_TOKEN);