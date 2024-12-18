Text to Speech
Text to Speech
Convert text to speech using our library of over 3,000 voices across 32 languages.

POST
/
v1
/
text-to-speech
/
{voice_id}
Send

Header
xi-api-key
string
Enter xi-api-key

Path
voice_id
string
*
Enter voice_id

Query
enable_logging
boolean
Select option
optimize_streaming_latency
integer, deprecated
Enter optimize_streaming_latency
output_format
string
Enter output_format

Body
​
Quick Start
Generate spoken audio from text with a simple request:


Python

Javascript

from elevenlabs import ElevenLabs

client = ElevenLabs(
    api_key="YOUR_API_KEY",
)
client.text_to_speech.convert(
    voice_id="JBFqnCBsd6RMkjVDRZzb",
    output_format="mp3_44100_128",
    text="Hello! 你好! Hola! नमस्ते! Bonjour! こんにちは! مرحبا! 안녕하세요! Ciao! Cześć! Привіт! வணக்கம்!",
    model_id="eleven_multilingual_v2"
)
​
Why Choose ElevenLabs?
Our AI model produces the highest-quality voices in the industry.

voices
Premium Voice Quality
Chooose from over 3,000 voices or clone your own. Our industry-leading voice technology delivers the most natural-sounding AI conversations.

32 Languages
Choose from over 32 languages with 1000s of voices, for every use-case, at 192kbps

Ultra-low latency
As low as ~250ms (+ network latency) audio generation times with our Turbo model.

Natural Prosody
Understands natural speech patterns for lifelike rhythm and intonation.

​
Concurrent Request Limits
The maximum number of concurrent requests you can run in parallel depends on your subscription tier.

The concurrent request limits don’t apply to enterprise tier. Talk to sales to discuss a custom plan.

Free & Starter
Free: 2 concurrent requests
Starter: 3 concurrent requests
Creator & Pro
Creator: 5 concurrent requests
Pro: 10 concurrent requests
Scale & Business
Scale: 15 concurrent requests
Business: 15 concurrent requests
Enterprise
Need higher limits? Talk to sales

​
Supported Languages
Our TTS API is multilingual and currently supports 32 languages across multiple regions.

Asia & Pacific
Chinese
Japanese
Korean
Vietnamese
Filipino
Indonesian
Malay
Tamil
Hindi
Europe (West)
English
French
German
Italian
Spanish
Dutch
Portuguese
Norwegian
Swedish
Danish
Europe (East)
Polish
Ukrainian
Russian
Czech
Slovak
Romanian
Bulgarian
Croatian
Greek
Hungarian
Finnish
Turkish
Classic Arabic
To use any of these languages, simply provide the input text in your language of choice.

Streaming API
Dig into the details of using the ElevenLabs TTS API.

Websockets
Learn how to use our API with websockets.

Join Our Discord
A great place to ask questions and get help from the community.

Integration Guides
Learn how to integrate ElevenLabs into your workflow.

Headers
​
xi-api-key
string
Your API key. This is required by most endpoints to access our API programatically. You can view your xi-api-key using the 'Profile' tab on the website.

Path Parameters
​
voice_id
string
required
Voice ID to be used, you can use https://api.elevenlabs.io/v1/voices to list all the available voices.

Query Parameters
​
enable_logging
boolean
default: true
When enable_logging is set to false full privacy mode will be used for the request. This will mean history features are unavailable for this request, including request stitching. Full privacy mode may only be used by enterprise customers.

​
optimize_streaming_latency
integer
deprecated
You can turn on latency optimizations at some cost of quality. The best possible final latency varies by model. Possible values:
0 - default mode (no latency optimizations)
1 - normal latency optimizations (about 50% of possible latency improvement of option 3)
2 - strong latency optimizations (about 75% of possible latency improvement of option 3)
3 - max latency optimizations
4 - max latency optimizations, but also with text normalizer turned off for even more latency savings (best latency, but can mispronounce eg numbers and dates).

Defaults to None.

​
output_format
string
default: mp3_44100_128
Output format of the generated audio. Must be one of:
mp3_22050_32 - output format, mp3 with 22.05kHz sample rate at 32kbps.
mp3_44100_32 - output format, mp3 with 44.1kHz sample rate at 32kbps.
mp3_44100_64 - output format, mp3 with 44.1kHz sample rate at 64kbps.
mp3_44100_96 - output format, mp3 with 44.1kHz sample rate at 96kbps.
mp3_44100_128 - default output format, mp3 with 44.1kHz sample rate at 128kbps.
mp3_44100_192 - output format, mp3 with 44.1kHz sample rate at 192kbps. Requires you to be subscribed to Creator tier or above.
pcm_16000 - PCM format (S16LE) with 16kHz sample rate.
pcm_22050 - PCM format (S16LE) with 22.05kHz sample rate.
pcm_24000 - PCM format (S16LE) with 24kHz sample rate.
pcm_44100 - PCM format (S16LE) with 44.1kHz sample rate. Requires you to be subscribed to Pro tier or above.
ulaw_8000 - μ-law format (sometimes written mu-law, often approximated as u-law) with 8kHz sample rate. Note that this format is commonly used for Twilio audio inputs.

Body
application/json
​
text
string
required
The text that will get converted into speech.

​
model_id
string
default: eleven_monolingual_v1
Identifier of the model that will be used, you can query them using GET /v1/models. The model needs to have support for text to speech, you can check this using the can_do_text_to_speech property.

​
language_code
string
Language code (ISO 639-1) used to enforce a language for the model. Currently only Turbo v2.5 supports language enforcement. For other models, an error will be returned if language code is provided.

​
voice_settings
object
Voice settings overriding stored setttings for the given voice. They are applied only on the given request.


Hide child attributes

​
voice_settings.stability
number
required
​
voice_settings.similarity_boost
number
required
​
voice_settings.style
number
default: 0
​
voice_settings.use_speaker_boost
boolean
default: true
​
pronunciation_dictionary_locators
object[]
A list of pronunciation dictionary locators (id, version_id) to be applied to the text. They will be applied in order. You may have up to 3 locators per request


Hide child attributes

​
pronunciation_dictionary_locators.pronunciation_dictionary_id
string
required
​
pronunciation_dictionary_locators.version_id
string
required
​
seed
integer
If specified, our system will make a best effort to sample deterministically, such that repeated requests with the same seed and parameters should return the same result. Determinism is not guaranteed. Must be integer between 0 and 4294967295.

​
previous_text
string
The text that came before the text of the current request. Can be used to improve the flow of prosody when concatenating together multiple generations or to influence the prosody in the current generation.

​
next_text
string
The text that comes after the text of the current request. Can be used to improve the flow of prosody when concatenating together multiple generations or to influence the prosody in the current generation.

​
previous_request_ids
string[]
A list of request_id of the samples that were generated before this generation. Can be used to improve the flow of prosody when splitting up a large task into multiple requests. The results will be best when the same model is used across the generations. In case both previous_text and previous_request_ids is send, previous_text will be ignored. A maximum of 3 request_ids can be send.

​
next_request_ids
string[]
A list of request_id of the samples that were generated before this generation. Can be used to improve the flow of prosody when splitting up a large task into multiple requests. The results will be best when the same model is used across the generations. In case both next_text and next_request_ids is send, next_text will be ignored. A maximum of 3 request_ids can be send.

​
use_pvc_as_ivc
boolean
default: false
deprecated
If true, we won't use PVC version of the voice for the generation but the IVC version. This is a temporary workaround for higher latency in PVC versions.

​
apply_text_normalization
enum<string>
default: auto
This parameter controls text normalization with three modes: 'auto', 'on', and 'off'. When set to 'auto', the system will automatically decide whether to apply text normalization (e.g., spelling out numbers). With 'on', text normalization will always be applied, while with 'off', it will be skipped. Cannot be turned on for 'eleven_turbo_v2_5' model.

Available options: auto, on, off 
Response
200 - audio/mpeg
The response is of type file.