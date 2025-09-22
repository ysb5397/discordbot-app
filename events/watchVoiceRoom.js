const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');

// --- 설정해야 할 부분 ---
const BOT_TOKEN = env.DISCORD_BOT_TOKEN;
const TARGET_CHANNEL_ID = "1353292092016693282";
// ---------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.once('ready', async () => {
    console.log(`${client.user.tag} 봇이 준비되었어! 🚀`);
    const targetChannel = await client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
    if (targetChannel && targetChannel.type === ChannelType.GuildVoice) {
        const humanMembers = targetChannel.members.filter(member => !member.user.bot);
        if (humanMembers.size > 0) {
            console.log(`'${targetChannel.name}' 채널에 이미 유저가 있어서 접속할게!`);
            joinVoiceChannel({
                channelId: targetChannel.id,
                guildId: targetChannel.guild.id,
                adapterCreator: targetChannel.guild.voiceAdapterCreator,
            });
        }
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.member.user.bot) return;

    const targetChannel = await client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
    if (!targetChannel) {
        console.log(`ID가 ${TARGET_CHANNEL_ID}인 채널을 찾을 수 없어. ID를 다시 확인해줘!`);
        return;
    }

    // 조건 1: 유저가 감시 채널에 들어왔을 때
    if (!oldState.channelId && newState.channelId === TARGET_CHANNEL_ID) {
        const connection = getVoiceConnection(newState.guild.id);
        // 봇이 아직 음성 채널에 없다면 접속
        if (!connection) {
            console.log(`'${newState.member.displayName}'님이 '${targetChannel.name}' 채널에 들어와서 나도 접속할게!`);
            joinVoiceChannel({
                channelId: targetChannel.id,
                guildId: targetChannel.guild.id,
                adapterCreator: targetChannel.guild.voiceAdapterCreator,
            });
        }
    }

    // 조건 2: 유저가 감시 채널에서 나갔을 때
    else if (oldState.channelId === TARGET_CHANNEL_ID && newState.channelId !== TARGET_CHANNEL_ID) {
        // 채널에 남아있는 사람 중에 봇이 아닌 사람이 한 명도 없으면
        const humanMembers = targetChannel.members.filter(member => !member.user.bot);
        if (humanMembers.size === 0) {
            const connection = getVoiceConnection(oldState.guild.id);
            if (connection) {
                console.log(`'${targetChannel.name}' 채널에 아무도 없어서 나갈게... 😢`);
                connection.destroy();
            }
        }
    }
});

client.login(BOT_TOKEN);