Pod::Spec.new do |s|
  s.name           = 'DosyaPersonasBackground'
  s.version        = '1.0.0'
  s.summary        = 'Background windows for the Personas reader: BGProcessingTask and, on iOS 26+, BGContinuedProcessingTask'
  s.description    = 'Registers the Personas processing task at launch, hands each window to the JS runner and completes it when the runner is done or the window expires.'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'BackgroundTasks'
  s.source_files = "**/*.swift"
end
