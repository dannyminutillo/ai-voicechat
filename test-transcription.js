const fs = require('fs');
const speech = require('@google-cloud/speech');

// Ensure Google Cloud credentials are set
process.env.GOOGLE_APPLICATION_CREDENTIALS = "./google-credentials.json";

async function transcribeAudio() {
    const speechClient = new speech.SpeechClient();
    
    // Read the raw audio file
    const audioData = fs.readFileSync('twilio-audio.raw');
    
    // Convert raw audio to Base64 for Google Speech API
    const audioBytes = audioData.toString('base64');

    // Set up Google Speech-to-Text config
    const request = {
        config: {
            encoding: 'MULAW',   // Make sure this matches Twilio's encoding
            sampleRateHertz: 8000, // Twilio uses 8000 Hz
            languageCode: 'en-US',
        },
        audio: {
            content: audioBytes,
        },
    };

    try {
        console.log("🔍 Sending audio to Google Speech API...");
        const [response] = await speechClient.recognize(request);
        console.log("📝 Google Transcription Response:", response);

        if (response.results.length > 0 && response.results[0].alternatives.length > 0) {
            console.log("✅ Transcribed Text:", response.results[0].alternatives[0].transcript);
        } else {
            console.warn("⚠️ Google did not recognize any speech in the file.");
        }
    } catch (error) {
        console.error("❌ Speech Recognition Error:", error);
    }
}

transcribeAudio();
