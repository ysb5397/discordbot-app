const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ApiKey } = require('../../utils/system/database');
const crypto = require('crypto');

const OWNER_ID = process.env.MY_DISCORD_USER_ID;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset_key')
        .setDescription('Flutter 앱의 API 키를 재발급합니다. (관리자 전용)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            await interaction.reply({ content: "이 명령어는 관리자만 사용가능합니다.", ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        const keyName = "Flutter AI";

        const newKey = `flutterAI-v${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

        await ApiKey.updateMany(
            { keyName: keyName, isCurrent: true },
            { $set: { isCurrent: false, isActive: true } }
        );

        const result = await ApiKey.findOneAndUpdate(
            { keyName: keyName },
            {
                $set: { apiKey: newKey, isCurrent: true, isActive: true }
            },
            { upsert: true, new: true }
        );

        await interaction.editReply(
            '✅ **AI 호출용 API 키 재발급 성공!**\n' +
            `이제 '${result.keyName}' 키는 \`${result.apiKey}\` 값을 사용합니다.\n` +
            'Flutter 앱은 다음번 로그인 시 새 키를 받아가게 됩니다.'
        );
    },
};