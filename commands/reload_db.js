const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { reconnectDB } = require('../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reload_db')
        .setDescription('MongoDB 데이터베이스 연결을 다시 시작합니다.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            await reconnectDB();
            await interaction.editReply('✅ 데이터베이스 연결을 성공적으로 다시 시작했습니다.');
        } catch (error) {
            console.error('DB 재연결 중 오류 발생:', error);
            await interaction.editReply('❌ 데이터베이스 연결을 다시 시작하는 중 오류가 발생했습니다.');
        }
    },
};