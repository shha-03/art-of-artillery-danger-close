# User-provided artillery recordings

The user supplied `sound1.mp3` (breech mechanism), `sound2.mp3` (loading), and `sound3.mp3` (firing), and assigned these roles. They replace the earlier mechanical excerpts and the synthesized firing sound.

All three sources are stereo MPEG-1 Layer III at 44,100 Hz and 192 kbit/s. The deployed files contain their original MPEG audio frames without re-encoding. ID3 export metadata was removed because it contained a local project path. No private source path or complete source video is included.

| Game cue | Source | Decoded interval | Duration | Constant gain |
| --- | --- | --- | --- | --- |
| Breech open | sound1.mp3 | 0.00–0.68 s | 0.680000000 s | 5.780593767732224 |
| Shell load | sound2.mp3 | Entire recording | 1.175510204 s | 6.830070598341799 |
| Breech close | sound1.mp3 | 0.68 s to end | 0.391020408 s | 5.780593767732224 |
| Fire | sound3.mp3 | Entire recording | 3.369795918 s | 3.7817304978327306 |

`sound1.mp3` contains 47,232 decoded samples per channel (1.071020408 s), `sound2.mp3` 51,840, and `sound3.mp3` 148,608. A QA-only mpg123 decoder reported no decoding errors. Browser resampling can change the sample count; loading and firing play the complete browser-decoded buffer, and closing plays the remainder after 0.68 s.

The breech split is a game mapping based on measured signal structure, not a claim of direct listening or precise identification of individual mechanism parts. Repeated activity occurs around 0.05–0.60 s, followed by a lower-energy interval around 0.61–0.68 s. The final stronger contact peaks at about 0.7643 s. Opening uses the earlier portion and closing uses the final contact. Both use the same decoded buffer and the same constant gain.

Playback retains original speed, pitch, stereo channels, and recorded background sound. The only audio-level processing is a constant gain per source, chosen to bring its measured peak to 0.32 before the existing shared output gain/compressor. There is no equalization, denoising, added envelope, time stretching, synthesized firing layer, or added reverb on these recordings. The full firing tail may overlap flight, impact, and radio; normal phase transitions do not stop it. OFF, cancellation, or leaving the page still stops active audio immediately.

The opening, loading, and closing stages last 720, 1,220, and 440 ms respectively. The firing phase waits 400 ms before the flight delay, accommodating the recording's main onset around 0.34 s. Impact, salvo impact, radio, bugle, and failure effects remain synthesized.

| File | Input SHA-256 | Deployed audio-frame SHA-256 |
| --- | --- | --- |
| sound1.mp3 | `40b1d7f39fccea532cfa4d625dadb9fbe612826743ac0bed1533745e273aa439` | `be3566204c73c56c798953829010f28106a2bde51926423c1c055644d3237a16` |
| sound2.mp3 | `9fcfca60003b6c877a4f81b730e59d827da26a106ed83adba45014a6ec24ca2e` | `eb7bcf7ad7846fb0abe0f48d7bb3b7ea619fa2ab833082b3c6cb60928940c31d` |
| sound3.mp3 | `150387d351ab19ccb6e249545c97093b25e0b8521463c3b1e855a13b82f8c0d6` | `351797f3ffca9c11486b09b1ee58914acf074e90907b6d8faab335091941a503` |

Decoder packages and decoded QA samples are excluded from the shipped application; the browser uses native `decodeAudioData`.
