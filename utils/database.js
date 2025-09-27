const mongoose = require('mongoose');

// 모든 종류의 상호작용을 저장하기 위한 통합 스키마
const interactionSchema = new mongoose.Schema({
    // 상호작용 ID (메시지 ID, 음성 세션 ID 등)
    interactionId: { type: String, required: true, unique: true },
    // 사용자 정보
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    // 상호작용 타입
    type: {
        type: String,
        enum: ['MESSAGE', 'MENTION', 'VOICE', 'ERROR'],
        required: true
    },
    // 상호작용 내용
    content: { type: String, required: true },
    // 봇의 응답 (있을 경우)
    botResponse: { type: String },
    // 발생 시간
    timestamp: { type: Date, default: Date.now }
});

const Interaction = mongoose.model('Interaction', interactionSchema);

module.exports = {
    Interaction,
    connectDB: () => {
        mongoose.connect(process.env.MONGO_URI)
            .then(() => console.log('성공적으로 MongoDB에 연결되었어! ✅'))
            .catch(err => console.error('MongoDB 연결에 실패했어... 😭', err));
    }
};
