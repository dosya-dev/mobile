Pod::Spec.new do |s|
  s.name           = 'DosyaDocumentScanner'
  s.version        = '1.0.0'
  s.summary        = 'VisionKit document camera that hands back one PDF'
  s.description    = 'Presents the system document scanner and writes the scanned pages into a single PDF in the cache directory.'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'VisionKit'
  s.source_files = "**/*.swift"
end
