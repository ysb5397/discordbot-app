// commands/maintain.js

const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Interaction } = require('../utils/database.js');
const config = require('../config/manage_environments.js');
const fs = require('fs').promises;
const path = require('path');

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(config.ai.geminiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

const OWNER_ID = config.discord.ownerId;

/**
 * 에러 스택에서 파일 경로와 줄 번호를 추출하는 함수
 */
function parseStackTrace(stack) {
    const lines = stack.split('\n');
    for (const line of lines) {
        const match = line.match(/\((.+):(\d+):(\d+)\)/) || line.match(/at\s+(.+):(\d+):(\d+)/);
        if (match) {
            const fullPath = match[1];
            if (!fullPath.includes('node_modules') && (fullPath.startsWith('/') || fullPath.match(/^[a-zA-Z]:\\/))) {
                return {
                    filePath: fullPath,
                    line: parseInt(match[2]),
                    column: parseInt(match[3])
                };
            }
        }
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('maintain')
        .setDescription('미해결된 에러를 AI가 분석하고 보고서를 작성합니다. (관리자 전용)'),

    async execute(interaction) {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: '❌ 관리자만 사용할 수 있는 명령어입니다.', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            const targetError = await Interaction.findOne({ 
                type: 'ERROR', 
                botResponse: 'Unresolved' 
            }).sort({ timestamp: -1 });

            if (!targetError) {
                return interaction.editReply('🎉 **현재 해결되지 않은 시스템 에러가 없습니다!** 서버가 아주 건강해요.');
            }

            const errorData = targetError.content;
            const stackTrace = errorData.stack || '';
            
            const fileInfo = parseStackTrace(stackTrace);
            let fileContext = "파일 위치를 특정할 수 없음 (라이브러리 내부 에러 등)";
            let fileName = "unknown";

            if (fileInfo) {
                try {
                    const fullContent = await fs.readFile(fileInfo.filePath, 'utf-8');
                    const lines = fullContent.split('\n');
                    fileName = path.basename(fileInfo.filePath);

                    const startLine = Math.max(0, fileInfo.line - 16);
                    const endLine = Math.min(lines.length, fileInfo.line + 15);
                    
                    fileContext = lines.slice(startLine, endLine)
                        .map((l, i) => {
                            const currentLine = startLine + i + 1;
                            const marker = currentLine === fileInfo.line ? '>>>> [ERROR HERE] >>>> ' : '    ';
                            return `${marker}${currentLine} | ${l}`;
                        })
                        .join('\n');
                } catch (readErr) {
                    fileContext = `파일을 읽을 수 없음: ${readErr.message}`;
                }
            }

            await interaction.editReply('🕵️‍♂️ **AI가 에러를 분석 중입니다...** (코드 확인 및 해결책 생성 중)');

            const prompt = `
                You are an expert Node.js Backend Developer. Analyze the following error and code snippet from a Discord bot.
                
                [Error Info]
                - Message: ${errorData.errorMessage}
                - Context Log: ${errorData.message}
                
                [Stack Trace]
                ${stackTrace}
                
                [Source Code Context (File: ${fileName})]
                \`\`\`javascript
                ${fileContext}
                \`\`\`
                
                [Task]
                1. Analyze the root cause of this error.
                2. Provide a specific solution or fixed code block.
                3. Output ONLY in Korean. Write in a professional Markdown report format.
            `;

            const result = await model.generateContent(prompt);
            const reportContent = result.response.text();

            const reportAttachment = new AttachmentBuilder(Buffer.from(reportContent, 'utf-8'), { name: `maintenance_report_${targetError._id}.md` });

            const resolveBtn = new ButtonBuilder()
                .setCustomId(`resolve_${targetError._id}`)
                .setLabel('✅ 해결 완료 (Resolved)')
                .setStyle(ButtonStyle.Success);

            const row = new ActionRowBuilder().addComponents(resolveBtn);

            const responseMessage = await interaction.editReply({
                content: `🚨 **[미해결 에러 진단 보고서]**\n\n- **발생 시각**: <t:${Math.floor(new Date(targetError.timestamp).getTime() / 1000)}:R>\n- **파일**: \`${fileName}\`\n- **에러 메시지**: \`${errorData.errorMessage}\`\n\n보고서를 확인하고 문제가 해결되었다면 아래 버튼을 눌러주세요.`,
                files: [reportAttachment],
                components: [row]
            });

            const collector = responseMessage.createMessageComponentCollector({ time: 3600000 });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ content: '관리자만 이 에러를 처리할 수 있습니다.', ephemeral: true });
                }

                if (i.customId === `resolve_${targetError._id}`) {
                    await Interaction.updateOne(
                        { _id: targetError._id }, 
                        { $set: { botResponse: 'Resolved' } }
                    );

                    await i.update({
                        content: `✅ **에러 처리가 완료되었습니다!** (ID: ${targetError._id})\n수고하셨습니다!`,
                        components: [],
                        files: []
                    });
                    collector.stop();
                }
            });

        } catch (e) {
            console.error(e);
            const errorMsg = `❌ 진단 도중 오류가 발생했습니다: ${e.message}`;
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ content: errorMsg, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMsg, ephemeral: true });
            }
        }
    },
};