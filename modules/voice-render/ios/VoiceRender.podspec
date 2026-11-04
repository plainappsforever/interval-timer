Pod::Spec.new do |s|
  s.name           = 'VoiceRender'
  s.version        = '0.1.0'
  s.summary        = 'Renders a spoken text into an audio file with the phone voice (Plain Intervals D15).'
  s.description    = 'AVSpeechSynthesizer.write(_:toBufferCallback:) into an AVAudioFile, used for pre-rendered voice cues.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift}"
end
