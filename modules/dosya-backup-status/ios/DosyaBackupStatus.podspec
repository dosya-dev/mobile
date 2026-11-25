Pod::Spec.new do |s|
  s.name           = 'DosyaBackupStatus'
  s.version        = '1.0.0'
  s.summary        = 'Backup status bridge: App Group snapshot for the widget + Live Activity control'
  s.description    = 'Writes backup engine snapshots to the shared App Group for the WidgetKit timeline and starts/updates/ends the backup Live Activity.'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.swift"
end
