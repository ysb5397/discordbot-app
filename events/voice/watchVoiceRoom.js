const { Events, ChannelType } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');

const TARGET_CHANNEL_ID = "1353292092016693282";

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        if (newState.member.user.bot) return;

        const client = newState.client;
        const targetChannel = await client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
        if (!targetChannel || targetChannel.type !== ChannelType.GuildVoice) {
            console.log(`ID가 ${TARGET_CHANNEL_ID}인 음성 채널을 찾을 수 없어. ID를 다시 확인해줘!`);
            return;
        }

        if (oldState.channelId !== TARGET_CHANNEL_ID && newState.channelId === TARGET_CHANNEL_ID) {
            const connection = getVoiceConnection(newState.guild.id);
            if (!connection) {
                console.log(`'${newState.member.displayName}'님이 '${targetChannel.name}' 채널에 들어와서 나도 접속할게!`);
                joinVoiceChannel({
                    channelId: targetChannel.id,
                    guildId: targetChannel.guild.id,
                    adapterCreator: targetChannel.guild.voiceAdapterCreator,
                });
            }
        }
        else if (oldState.channelId === TARGET_CHANNEL_ID && newState.channelId !== TARGET_CHANNEL_ID) {
            const humanMembers = oldState.channel.members.filter(member => !member.user.bot);
            if (humanMembers.size === 0) {
                const connection = getVoiceConnection(oldState.guild.id);
                if (connection) {
                    console.log(`'${targetChannel.name}' 채널에 아무도 없어서 나갈게... 😢`);
                    connection.destroy();
                }
            }
        }
    },
};