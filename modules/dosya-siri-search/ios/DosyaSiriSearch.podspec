require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'DosyaSiriSearch'
  s.version        = package['version']
  s.summary        = 'Bridges INPlayMediaIntent to JS for CarPlay/Siri voice search.'
  s.author         = 'dosya.dev'
  s.homepage       = 'https://dosya.dev'
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }
  s.license        = { :type => 'MIT' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,swift}"
end
