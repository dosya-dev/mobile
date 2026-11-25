Pod::Spec.new do |s|
  s.name           = 'DosyaVlcPlayer'
  s.version        = '1.0.0'
  s.summary        = 'libVLC video surface for containers AVPlayer cannot open'
  s.description    = 'AVFoundation has no demuxer for MKV, AVI, WebM and friends, so expo-video renders them as a black rectangle. libVLC ships its own demuxers and decoders; this module exposes a VLCMediaPlayer-backed view the viewer falls back to for exactly those containers. Android never loads this - ExoPlayer already plays them.'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  # MobileVLCKit is LGPL-2.1+, distributed by VideoLAN as a prebuilt framework
  # specifically so it can ship in App Store apps. The wrapper stays MIT.
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # 3.x is the stable line. 4.x ("VLCKit") is still pre-release - do not bump
  # a major here without a device pass; the delegate API changes.
  s.dependency 'MobileVLCKit', '~> 3.6'
  s.source_files = "**/*.swift"
end
