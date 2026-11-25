Pod::Spec.new do |s|
  s.name           = 'DosyaThermal'
  s.version        = '1.0.0'
  s.summary        = 'ProcessInfo thermal state + memory footprint for the backup engine pacing'
  s.description    = 'Exposes iOS thermal state (with change events) and the app memory footprint so the JS backup engine can pace itself.'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.swift"
end
