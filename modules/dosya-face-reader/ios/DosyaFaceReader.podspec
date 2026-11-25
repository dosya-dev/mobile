Pod::Spec.new do |s|
  s.name           = 'DosyaFaceReader'
  s.version        = '1.0.0'
  s.summary        = 'Native photo decode, file hash and ONNX Runtime sessions for the Personas face reader'
  s.description    = 'Decodes a JPEG or WebP to 8-bit sRGB RGBA with the platform decoder (no EXIF rotation, long side capped at 1600 by area averaging) and hashes files with SHA-256. Ported semantics of apps/web/src/lib/personas-device/ort/decode.ts.'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  # onnxruntime-objc (which pins onnxruntime-c to the same version) gives Swift a module; onnxruntime-c alone has none.
  s.dependency 'onnxruntime-objc', '1.29.0'
  s.source_files = "**/*.swift"
end
