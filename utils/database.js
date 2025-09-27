const mongoose = require('mongoose');

// 모든 종류의 상호작용을 저장하기 위한 통합 스키마
const interactionSchema = new mongoose.Schema({
    // 상호작용 ID (메시지 ID, 음성 세션 ID 등)
    interactionId: { type: String, required: true, unique: true },
    channelId: { type: String }, // 메시지가 발생한 채널 ID
    // 사용자 정보
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    // 상호작용 타입
    type: {
        type: String,
        enum: ['MESSAGE', 'MENTION', 'VOICE', 'ERROR', 'EARTHQUAKE'],
        required: true
    },
    // 상호작용 내용 (객체 저장을 위해 Mixed 타입으로 변경)
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    // 봇의 응답 (있을 경우)
    botResponse: { type: String },
    // 발생 시간
    timestamp: { type: Date, default: Date.now }
});

const Interaction = mongoose.model('Interaction', interactionSchema);

const connectDB = async () => {
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
        console.error('오류: MONGODB_URI 환경 변수가 설정되지 않았습니다. .env 파일을 확인해주세요.');
        return; 
    }

    try {
        await mongoose.connect(mongoURI);
        console.log('성공적으로 MongoDB에 연결되었어! ✅');
    } catch (err) {
        console.error('MongoDB 연결에 실패했어... 😭', err);
        throw err; 
    }
};

const disconnectDB = async () => {
    try {
        await mongoose.disconnect();
        console.log('MongoDB 연결이 성공적으로 종료되었어. 🛑');
    } catch (err) {
        console.error('MongoDB 연결 종료 중 오류 발생:', err);
        throw err;
    }
};

const reconnectDB = async () => {
    console.log('MongoDB 재연결을 시도합니다...');
    await disconnectDB();
    await connectDB();
};

module.exports = {
    Interaction,
    connectDB,
    disconnectDB,
    reconnectDB,
};
