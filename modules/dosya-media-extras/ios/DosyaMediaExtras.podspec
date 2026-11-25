Pod::Spec.new do |s|
  s.name           = 'DosyaMediaExtras'
  s.version        = '1.0.0'
  s.summary        = 'Live Photo paired-video extraction for the backup engine'
  s.description    = 'Exposes the paired video resource of a Live Photo, which expo-media-library does not surface, so the backup can include the motion and not just the still.'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.swift"
end
