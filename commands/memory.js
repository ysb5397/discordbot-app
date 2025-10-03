const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder } = require('discord.js');
const { Interaction } = require('../utils/database.js');
const { generateMongoFilter } = require('../utils/ai_helper.js');

/** 헬퍼: 내용 축약 */
function formatContent(doc) {
    const content = doc.content || '';
    return content.length > 80 ? content.substring(0, 80) + '...' : content;
}

/** 헬퍼: 상호작용(버튼, 메뉴) ID 생성 */
function createCustomId(action, interactionId, docId = null) {
    return `${action}_${interactionId}${docId ? `_${docId}` : ''}`;
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
        const newContent = interaction.options.getString('new_content');

        await interaction.deferReply({ ephemeral: true });

        try {
            const filter = await generateMongoFilter(query, userId);
            const results = await Interaction.find(filter).sort({ timestamp: -1 }).limit(10);

            if (results.length === 0) {
                return interaction.editReply('해당 설명과 일치하는 기억을 찾을 수 없습니다. 좀 더 자세하게 설명해보세요.');
            }

            if (results.length > 1) {
                const options = results.map((doc, index) => ({
                    label: `기억 #${index + 1}: "${formatContent(doc)}"`,
                    description: `(${new Date(doc.timestamp).toLocaleString('ko-KR')})`,
                    value: doc._id.toString(),
                }));

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(createCustomId(`memory_select_${subcommand}`, interaction.id))
                    .setPlaceholder('수정하거나 삭제할 기억을 하나 선택하세요.')
                    .addOptions(options);

                const row = new ActionRowBuilder().addComponents(selectMenu);
                const embed = new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setTitle('기억 선택')
                    .setDescription(`"${query}"에 대한 검색 결과가 여러 개 발견되었어. 아래 메뉴에서 원하는 기억을 하나 골라줘.`);

                await interaction.editReply({ embeds: [embed], components: [row] });

            } else {
                const doc = results[0];
                const embed = new EmbedBuilder().setTitle('기억 관리').setColor(0xFFD700);
                let description = `**요청 내용:** "${query}"\n**선택된 기억:**\n[메시지 바로가기](https://discord.com/channels/${interaction.guildId}/${doc.channelId}/${doc.interactionId}) "${formatContent(doc)}"`;

                if (subcommand === 'update') {
                    description += `\n\n**[새로운 내용]**\n"${newContent}"\n\n이 기억을 새로운 내용으로 수정할까요? (DB만 수정되며, 원본 메시지에 답글이 달립니다)`;
                } else {
                    description += `\n\n이 기억을 정말로 삭제할까요? (디스코드 메시지도 함께 삭제됩니다)`;
                }
                embed.setDescription(description);

                const confirmButton = new ButtonBuilder().setCustomId(createCustomId(`memory_${subcommand}_confirm`, interaction.id, doc._id)).setLabel('실행').setStyle(subcommand === 'delete' ? ButtonStyle.Danger : ButtonStyle.Primary);
                const cancelButton = new ButtonBuilder().setCustomId(createCustomId('cancel', interaction.id)).setLabel('취소').setStyle(ButtonStyle.Secondary);
                const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                await interaction.editReply({ embeds: [embed], components: [row] });
            }

            const collector = interaction.channel.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id && i.customId.includes(interaction.id),
                time: 120000
            });

            collector.on('collect', async i => {
                await i.deferUpdate();
                
                if (i.isStringSelectMenu()) {
                    const selectedId = i.values[0];
                    const selectedDoc = results.find(r => r._id.toString() === selectedId);
                    
                    const embed = new EmbedBuilder().setTitle('기억 관리').setColor(0xFFD700);
                    let description = `**요청 내용:** "${query}"\n**선택된 기억:**\n[메시지 바로가기](https://discord.com/channels/${interaction.guildId}/${selectedDoc.channelId}/${selectedDoc.interactionId}) "${formatContent(selectedDoc)}"`;
                    if (subcommand === 'update') {
                         description += `\n\n**[새로운 내용]**\n"${newContent}"\n\n이 기억을 새로운 내용으로 수정할까요? (DB만 수정되며, 원본 메시지에 답글이 달립니다)`;
                    } else {
                        description += `\n\n이 기억을 정말로 삭제할까요? (디스코드 메시지도 함께 삭제됩니다)`;
                    }
                    embed.setDescription(description);
                    
                    const confirmButton = new ButtonBuilder().setCustomId(createCustomId(`memory_${subcommand}_confirm`, interaction.id, selectedDoc._id)).setLabel('실행').setStyle(subcommand === 'delete' ? ButtonStyle.Danger : ButtonStyle.Primary);
                    const cancelButton = new ButtonBuilder().setCustomId(createCustomId('cancel', interaction.id)).setLabel('취소').setStyle(ButtonStyle.Secondary);
                    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);
                    
                    await interaction.editReply({ embeds: [embed], components: [row] });
                    return;
                }

                if (i.isButton()) {
                    collector.stop();
                    const [action, ...rest] = i.customId.split('_');
                    const docId = rest.pop();

                    if (action === 'cancel') {
                        return interaction.editReply({ content: '작업이 취소되었습니다.', embeds: [], components: [] });
                    }

                    const targetDoc = await Interaction.findById(docId);
                    if (!targetDoc) {
                        return interaction.editReply({ content: '오류: 작업을 처리할 기억을 찾지 못했습니다.', embeds: [], components: [] });
                    }

                    if (i.customId.startsWith('memory_delete_confirm')) {
                        try {
                            const channel = await interaction.client.channels.fetch(targetDoc.channelId);
                            const message = await channel.messages.fetch(targetDoc.interactionId);
                            await message.delete();
                        } catch (e) {
                            console.log(`Discord 메시지 삭제 실패 (ID: ${targetDoc.interactionId}): ${e.message}`);
                        }
                        await Interaction.deleteOne({ _id: targetDoc._id });
                        await interaction.editReply({ content: '✅ 선택한 기억 1개를 성공적으로 삭제했습니다.', embeds: [], components: [] });

                    } else if (i.customId.startsWith('memory_update_confirm')) {
                        await Interaction.updateOne({ _id: targetDoc._id }, { $set: { content: newContent } });
                        try {
                            const channel = await interaction.client.channels.fetch(targetDoc.channelId);
                            const message = await channel.messages.fetch(targetDoc.interactionId);
                            await message.reply(`이 기억은 다음과 같이 수정되었습니다: "${newContent}"`);
                        } catch (e) {
                            console.log(`원본 메시지에 답글 달기 실패 (ID: ${targetDoc.interactionId}): ${e.message}`);
                        }
                        await interaction.editReply({ content: '✅ 기억을 성공적으로 수정하고, 원본 메시지에 답글을 남겼습니다.', embeds: [], components: [] });
                    }
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