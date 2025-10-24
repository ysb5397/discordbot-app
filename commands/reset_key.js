const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ApiKey } = require('../utils/database');
const crypto = require('crypto'); // 새 키 생성을 위해 내장 모듈 사용

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset_key')
        .setDescription('Flutter 앱의 API 키를 재발급합니다. (관리자 전용)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
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
            );
            
            // 3. 새 키를 DB에 "Current"이자 "Active"로 저장
            const result = await ApiKey.findOneAndUpdate(
                { keyName: keyName },
                { 
                    $set: {
                        apiKey: newKey, 
                        isCurrent: true, 
                        isActive: true
                    } 
                },
                { 
                    upsert: true,
                    new: true
                } 
            );

            await interaction.editReply(
                '✅ **API 키 재발급(덮어쓰기) 성공!**\n' +
                `이제 '${result.keyName}' 키는 \`${result.apiKey}\` 값을 사용합니다.\n` +
                'Flutter 앱은 재시작 시 새 키를 받아가게 됩니다.'
            );

        } catch (error) {
            console.error('[/rotate_key] Error:', error);
            await interaction.editReply(`❌ 키 재발급 실패: ${error.message}`);
        }
    },
};