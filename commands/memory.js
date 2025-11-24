const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { Interaction } = require('../utils/database.js');
const { getEmbedding, generateAttachmentDescription } = require('../utils/ai_helper.js');
const { createBaseEmbed } = require('../utils/embed_builder.js');

/** 헬퍼: 내용 축약 */
function formatContent(content) {
    if (!content) return '(내용 없음)';
    const text = typeof content === 'string' ? content : JSON.stringify(content);
    return text.length > 80 ? text.substring(0, 80) + '...' : text;
}

/** 헬퍼: 상호작용 ID 생성 */
function createCustomId(action, interactionId, docId = null) {
    return `${action}_${interactionId}${docId ? `_${docId}` : ''}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('memory')
        .setDescription('나만의 기억(대화 내용)을 관리합니다.')
        // 1. 기억 추가 (ID 기반)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('특정 메시지를 기억에 저장합니다.')
                .addStringOption(option => option.setName('message_id').setDescription('저장할 메시지의 ID').setRequired(true)))
        // 2. 기억 수정 (ID 기반)
        .addSubcommand(subcommand =>
            subcommand
                .setName('update')
                .setDescription('특정 기억의 내용을 수정합니다.')
                .addStringOption(option => option.setName('message_id').setDescription('수정할 메시지 ID (interactionId)').setRequired(true))
                .addStringOption(option => option.setName('new_content').setDescription('새로운 내용').setRequired(true)))
        // 3. 기억 검색 (벡터 기반)
        .addSubcommand(subcommand =>
            subcommand
                .setName('search')
                .setDescription('저장된 기억을 의미 기반으로 검색합니다.')
                .addStringOption(option => option.setName('query').setDescription('검색할 내용 (예: 맛집 추천해줘)').setRequired(true)))
        // 4. 기억 삭제 (벡터 기반)
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('기억을 검색하여 삭제합니다.')
                .addStringOption(option => option.setName('query').setDescription('삭제할 기억에 대한 설명').setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        await interaction.deferReply({ ephemeral: true });

        // ====================================================
        // 1. [ADD] 메시지 ID로 기억 추가
        // ====================================================
        if (subcommand === 'add') {
            const messageId = interaction.options.getString('message_id');

            try {
                await interaction.editReply("메시지 잠시만 살펴볼게...!");

                // 이미 저장된 기억인지 확인
                const exists = await Interaction.findOne({ interactionId: messageId });
                if (exists) {
                    return interaction.editReply('❌ 이미 내 기억 속에 저장된 메시지야!');
                }

                // 현재 채널에서 메시지 가져오기 시도
                const message = await interaction.channel.messages.fetch(messageId).catch(() => null);

                if (!message) {
                    return interaction.editReply('❌ 메시지를 찾을 수 없어. 같은 채널에 있는 메시지 ID가 맞아?');
                }

                const content = message.content || '';

                if (message.attachments.size > 0 || message.content.trim() === '') {
                    if (message.attachments.size >= 5) {
                        await interaction.editReply("잠깐, 이미지가 너무 많아...! ");
                        return;
                    }

                    const attachmentPromises = message.attachments.map(att => generateAttachmentDescription(att));
                    const results = await Promise.all(attachmentPromises);
                    content = results.join('\n\n');
                }

                // 임베딩 생성
                const embedding = await getEmbedding(content);

                // DB 저장
                await Interaction.create({
                    interactionId: message.id,
                    channelId: message.channelId,
                    userId: userId, // 명령어를 실행한 유저의 기억으로 저장
                    userName: interaction.user.username,
                    type: 'MESSAGE', // 일반 메시지 타입으로 저장
                    content: content,
                    embedding: embedding,
                    botResponse: null
                });

                const embed = createBaseEmbed({
                    title: '📥 기억 저장 완료',
                    description: `**내용:** "${formatContent(content)}"\n\n이 메시지를 소중히 간직할게!`,
                    color: 0x00FA9A
                });

                return interaction.editReply({ embeds: [embed] });

            } catch (error) {
                console.error('[Memory Add Error]', error);
                return interaction.editReply(`오류가 발생했어: ${error.message}`);
            }
        }

        // ====================================================
        // 2. [UPDATE] 메시지 ID로 바로 수정
        // ====================================================
        if (subcommand === 'update') {
            const messageId = interaction.options.getString('message_id');
            const newContent = interaction.options.getString('new_content');

            try {
                // 내 기억 중에서 해당 ID 찾기
                const targetDoc = await Interaction.findOne({ interactionId: messageId, userId: userId });

                if (!targetDoc) {
                    return interaction.editReply('❌ 해당 ID를 가진 기억을 찾을 수 없어. 내 기억이 아니거나 없는 ID야.');
                }

                // 새로운 내용으로 임베딩 갱신
                const newEmbedding = await getEmbedding(newContent);

                // 업데이트 수행
                targetDoc.content = newContent;
                targetDoc.embedding = newEmbedding;
                await targetDoc.save();

                const embed = createBaseEmbed({
                    title: '✏️ 기억 수정 완료',
                    description: `**ID:** ${messageId}\n**변경된 내용:** "${newContent}"\n\n기억을 성공적으로 덮어썼어!`,
                    color: 0xFFA500
                });

                return interaction.editReply({ embeds: [embed] });

            } catch (error) {
                console.error('[Memory Update Error]', error);
                return interaction.editReply(`수정 중 오류가 발생했어: ${error.message}`);
            }
        }

        // ====================================================
        // 3. [SEARCH / DELETE] 벡터 검색 공통 로직
        // ====================================================
        const query = interaction.options.getString('query');
        const queryVector = await getEmbedding(query);

        if (!queryVector) {
            return interaction.editReply('임베딩 생성 실패. AI 상태를 확인해줘.');
        }

        // 벡터 검색 실행 (userId 필터링 포함)
        const results = await Interaction.aggregate([
            {
                "$vectorSearch": {
                    "index": "default",
                    "path": "embedding",
                    "queryVector": queryVector,
                    "numCandidates": 100,
                    "limit": 5, // 상위 5개만
                    "filter": {
                        "userId": { "$eq": userId }
                    }
                }
            },
            {
                "$project": {
                    "content": 1,
                    "channelId": 1,
                    "interactionId": 1,
                    "timestamp": 1,
                    "score": { "$meta": "vectorSearchScore" }
                }
            }
        ]);

        if (results.length === 0) {
            return interaction.editReply(`"${query}"... 으음, 관련된 기억이 하나도 안 떠올라.`);
        }

        // -- [SEARCH] 단순히 보여주기만 함 --
        if (subcommand === 'search') {
            const embed = createBaseEmbed({
                title: `🔍 "${query}" 검색 결과`,
                description: results.map((doc, i) =>
                    `**${i + 1}.** [이동](https://discord.com/channels/${interaction.guildId}/${doc.channelId}/${doc.interactionId}) ${formatContent(doc.content)} \n(유사도: ${(doc.score * 100).toFixed(1)}% | ID: \`${doc.interactionId}\`)`
                ).join('\n\n'),
                color: 0x3498DB
            });
            return interaction.editReply({ embeds: [embed] });
        }

        // -- [DELETE] 선택해서 삭제하기 --
        if (subcommand === 'delete') {
            // 선택지 생성
            const options = results.map((doc, index) => ({
                label: `기억 #${index + 1} (유사도: ${(doc.score * 100).toFixed(1)}%)`,
                description: formatContent(doc.content),
                value: doc._id.toString(),
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(createCustomId('memory_select_delete', interaction.id))
                .setPlaceholder('삭제할 기억을 선택해줘.')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const embed = createBaseEmbed({
                title: '🗑️ 기억 삭제',
                description: `"${query}"와 관련된 기억들을 찾아왔어.\n지우고 싶은 게 있다면 아래에서 선택해줘.`,
                color: 0xE74C3C
            });

            await interaction.editReply({ embeds: [embed], components: [row] });

            // 컬렉터 시작
            const collector = interaction.channel.createMessageComponentCollector({
                filter: i => i.user.id === userId && i.customId.includes(interaction.id),
                time: 60000
            });

            collector.on('collect', async i => {
                if (i.customId.includes('memory_select_delete')) {
                    await i.deferUpdate();
                    const selectedId = i.values[0];
                    const selectedDoc = results.find(r => r._id.toString() === selectedId);

                    // 확인 버튼 표시
                    const confirmEmbed = createBaseEmbed({
                        title: '⚠️ 정말 삭제할까?',
                        description: `**선택된 기억:**\n"${formatContent(selectedDoc.content)}"\n(ID: ${selectedDoc.interactionId})\n\n이 기억을 영구적으로 삭제할까?`,
                        color: 0xFF0000
                    });

                    const confirmBtn = new ButtonBuilder()
                        .setCustomId(createCustomId('confirm_delete', interaction.id, selectedDoc._id))
                        .setLabel('삭제하기')
                        .setStyle(ButtonStyle.Danger);

                    const cancelBtn = new ButtonBuilder()
                        .setCustomId(createCustomId('cancel', interaction.id))
                        .setLabel('취소')
                        .setStyle(ButtonStyle.Secondary);

                    const btnRow = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

                    await interaction.editReply({ embeds: [confirmEmbed], components: [btnRow] });
                }
                else if (i.customId.includes('confirm_delete')) {
                    const docId = i.customId.split('_').pop();
                    await Interaction.findByIdAndDelete(docId);

                    await i.update({
                        content: '✅ 기억이 깨끗하게 삭제되었어!',
                        embeds: [],
                        components: []
                    });
                    collector.stop();
                }
                else if (i.customId.includes('cancel')) {
                    await i.update({ content: '작업을 취소했어.', embeds: [], components: [] });
                    collector.stop();
                }
            });
        }
    },
};