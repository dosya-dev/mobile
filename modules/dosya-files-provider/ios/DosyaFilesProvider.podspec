Pod::Spec.new do |s|
  s.name           = 'DosyaFilesProvider'
  s.version        = '1.0.0'
  s.summary        = 'Files app bridge: linked session in the shared keychain + File Provider domain control'
  s.description    = 'Stores the Files extension its own linked session in the App Group keychain and adds, removes and signals the dosya.dev File Provider domain.'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'FileProvider'
  s.source_files = "**/*.swift"
end
