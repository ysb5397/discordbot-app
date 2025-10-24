const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ApiKey } = require('../utils/database');
const crypto = require('crypto'); // 새 키 생성을 위해 내장 모듈 사용

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset_key')
        .setDescription('Flutter 앱의 API 키를 재발급합니다. (관리자 전용)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // 너만 쓰게!
    
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // 1. 새 비밀 키 생성
            const newKey = `flutter-v${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
            const keyName = "Flutter App";

            // 2. (부드러운 전환) 기존의 'isCurrent=true'였던 모든 키를 'isCurrent=false'로 변경
            await ApiKey.updateMany(
                { keyName: keyName, isCurrent: true },
                { $set: { isCurrent: false } }
                // (중요!) isActive: true는 그대로 둬서, 기존 유저가 끊기지 않게 함!
            );
            
            // 3. 새 키를 DB에 "Current"이자 "Active"로 저장
            const createdKey = await ApiKey.create({
                keyName: keyName,
                apiKey: newKey,
                isActive: true,
                isCurrent: true
            });

            await interaction.editReply(
                '✅ **API 키 재발급 성공!**\n' +
                `새 키(${createdKey.apiKey})가 생성되어 DB에 저장되었습니다.\n` +
                '이제 Flutter 앱은 재시작 시 새 키를 받아가게 됩니다.'
            );

        } catch (error) {
            await interaction.editReply(`❌ 키 재발급 실패: ${error.message}`);
        }
    },
};