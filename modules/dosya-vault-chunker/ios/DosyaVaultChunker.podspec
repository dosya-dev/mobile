Pod::Spec.new do |s|
  s.name           = 'DosyaVaultChunker'
  s.version        = '1.0.0'
  s.summary        = 'Content-defined chunk boundaries (FastCDC) for the Vault, computed natively'
  s.description    = 'Port of e2ee-core chunker.ts. Reads a file and returns chunk offsets; no bytes cross the bridge and no key is involved.'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.swift"
end
