Pod::Spec.new do |s|
  s.name           = 'DosyaBackgroundUpload'
  s.version        = '1.0.0'
  s.summary        = 'Background URLSession uploads for photo backup: staging, job persistence, relaunch handling'
  s.description    = 'Background URLSession uploads for photo backup: staging, job persistence, relaunch handling'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.swift"
end
