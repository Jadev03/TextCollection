import AudioCollector from "./components/AudioCollector";

export default function Home() {
  // Sample text with Tamil and English mixed
  const sampleText = "Hello, நான் ஒரு developer. This is a test sentence with both English and தமிழ் text mixed together. The user needs to read this text and record their voice. நன்றி!";

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-8 px-4">
      <AudioCollector text={sampleText} />
    </div>
  );
}
