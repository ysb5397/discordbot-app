const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { Interaction } = require('../utils/database.js');
const fetch = require('node-fetch');

const flowiseEndpoint = process.env.FLOWISE_ENDPOINT;
const flowiseApiKey = process.env.FLOWISE_API_KEY;

async function generateMongoFilter(query, userId) {
    const prompt = `
    You are a MongoDB query filter generator. A user wants to find an entry in their interaction history to modify or delete it. 
    Based on their request, create a JSON filter for a MongoDB 'find' operation. 
    
    - The user's ID is: "${userId}"
    - The user's natural language query is: "${query}"
    - The current date is: "${new Date().toISOString()}" 
    
    - The schema has these fields: 'userId', 'type', 'content', 'timestamp', 'channelId'.
    - The 'type' can be 'MESSAGE' or 'MENTION'. Only search for these types.
    - For dates, use ISO 8601 format (e.g., {"$gte": "YYYY-MM-DDTHH:mm:ss.sssZ"}).
    - For text matching, use the '$regex' operator with '$options: "i"' for case-insensitivity.
    
    Respond ONLY with the raw JSON filter object. Do not include any other text or markdown.
    `;

    const response = await fetch(flowiseEndpoint, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json', 
            ...(flowiseApiKey ? { 'Authorization': `Bearer ${flowiseApiKey}` } : {}) 
        },
        body: JSON.stringify({ question: prompt, overrideConfig: { sessionId: `mongo-filter-gen-${userId}` } })
    });

    if (!response.ok) {
        throw new Error(`AI filter generation failed: ${response.statusText}`);
    }

    const aiResponse = await response.json();
    try {
        const filter = JSON.parse(aiResponse.text);
        filter.userId = userId;
        filter.type = { "$in": ["MESSAGE", "MENTION"] };
        return filter;
    } catch (e) {
        console.error("Failed to parse AI-generated filter:", aiResponse.text);
        throw new Error("AI가 생성한 필터를 분석하는데 실패했습니다.");
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('memory')
        .setDescription('저장된 당신의 기억(대화)을 관리합니다.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('특정 기억을 삭제합니다.')
                .addStringOption(option => option.setName('query').setDescription('삭제할 기억에 대한 설명 (예: 어제 피자 얘기)').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('update')
                .setDescription('특정 기억을 수정합니다.')
                .addStringOption(option => option.setName('query').setDescription('수정할 기억에 대한 설명').setRequired(true))
                .addStringOption(option => option.setName('new_content').setDescription('새로운 내용').setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const query = interaction.options.getString('query');
        const userId = interaction.user.id;

        await interaction.deferReply({ ephemeral: true });

        try {
            const filter = await generateMongoFilter(query, userId);
            const results = await Interaction.find(filter).sort({ timestamp: -1 }).limit(5);

            if (results.length === 0) {
                await interaction.editReply('해당 설명과 일치하는 기억을 찾을 수 없습니다. 좀 더 자세하게 설명해보세요.');
                return;
            }

            const embed = new EmbedBuilder().setTitle('기억 관리').setColor(0xFFD700);
            let description = `**요청 내용:** "${query}"
                                **검색된 기억 ${results.length}개:**
                                `;
            results.forEach((doc, index) => {
                const content = (doc.content && doc.content.length > 100) ? doc.content.substring(0, 100) + '...' : doc.content;
                description += `**${index + 1}.** [메시지 바로가기](https://discord.com/channels/${interaction.guildId}/${doc.channelId}/${doc.interactionId}) "${content}"
                                *(${new Date(doc.timestamp).toLocaleString('ko-KR')})*
                                `;
            });

            const row = new ActionRowBuilder();
            let confirmButton, cancelButton;

            if (subcommand === 'delete') {
                embed.setDescription(description + '\n**이 기억들을 정말로 삭제할까요? (디스코드 메시지도 함께 삭제됩니다)**');
                confirmButton = new ButtonBuilder().setCustomId(`memory_delete_confirm_${interaction.id}`).setLabel('삭제 실행').setStyle(ButtonStyle.Danger);
                cancelButton = new ButtonBuilder().setCustomId(`memory_cancel_${interaction.id}`).setLabel('취소').setStyle(ButtonStyle.Secondary);
            } else if (subcommand === 'update') {
                if (results.length > 1) {
                    await interaction.editReply('수정할 기억이 2개 이상 발견되었습니다. 하나의 기억만 특정될 수 있도록 더 자세하게 설명해주세요.');
                    return;
                }
                const newContent = interaction.options.getString('new_content');
                description += `\n---\n**[기존 내용]**\n"${results[0].content}"\n\n**[새로운 내용]**\n"${newContent}"\n\n**이 기억을 새로운 내용으로 수정할까요? (DB만 수정되며, 원본 메시지에 답글이 달립니다)**`;
                embed.setDescription(description);
                confirmButton = new ButtonBuilder().setCustomId(`memory_update_confirm_${interaction.id}`).setLabel('수정 실행').setStyle(ButtonStyle.Primary);
                cancelButton = new ButtonBuilder().setCustomId(`memory_cancel_${interaction.id}`).setLabel('취소').setStyle(ButtonStyle.Secondary);
            }

            row.addComponents(confirmButton, cancelButton);
            await interaction.editReply({ embeds: [embed], components: [row] });

            const collector = interaction.channel.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: '이 버튼은 명령어를 실행한 사용자만 누를 수 있습니다.', ephemeral: true });
                    return;
                }
                if (!i.customId.endsWith(interaction.id)) return;

                await i.deferUpdate();
                collector.stop();

                if (i.customId.startsWith('memory_delete_confirm')) {
                    for (const doc of results) {
                        try {
                            if (doc.channelId && doc.interactionId) {
                                const channel = await interaction.client.channels.fetch(doc.channelId);
                                const message = await channel.messages.fetch(doc.interactionId);
                                await message.delete();
                            }
                        } catch (e) {
                            console.log(`Discord 메시지 삭제 실패 (ID: ${doc.interactionId}): ${e.message}`);
                        }
                    }
                    const deleteResult = await Interaction.deleteMany(filter);
                    await interaction.editReply({ content: `✅ 기억 ${deleteResult.deletedCount}개를 성공적으로 삭제했습니다.`, embeds: [], components: [] });

                } else if (i.customId.startsWith('memory_update_confirm')) {
                    const docToUpdate = results[0];
                    const newContent = interaction.options.getString('new_content');
                    await Interaction.updateOne({ _id: docToUpdate._id }, { $set: { content: newContent } });
                    
                    try {
                        if (docToUpdate.channelId && docToUpdate.interactionId) {
                            const channel = await interaction.client.channels.fetch(docToUpdate.channelId);
                            const message = await channel.messages.fetch(docToUpdate.interactionId);
                            await message.reply({ content: `이 기억은 다음과 같이 수정되었습니다: "${newContent}"` });
                        }
                    } catch (e) {
                        console.log(`원본 메시지에 답글 달기 실패 (ID: ${docToUpdate.interactionId}): ${e.message}`);
                    }
                    await interaction.editReply({ content: '✅ 기억을 성공적으로 수정하고, 원본 메시지에 답글을 남겼습니다.', embeds: [], components: [] });

                } else if (i.customId.startsWith('memory_cancel')) {
                    await interaction.editReply({ content: '작업이 취소되었습니다.', embeds: [], components: [] });
                }
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    interaction.editReply({ content: '시간이 초과되어 작업이 자동으로 취소되었습니다.', embeds: [], components: [] });
                }
            });

        } catch (error) {
            console.error("Error in /memory command:", error);
            await interaction.editReply(`오류가 발생했습니다: ${error.message}`);
        }
    },
};