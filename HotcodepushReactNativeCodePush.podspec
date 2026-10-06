require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'HotcodepushReactNativeCodePush'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = package['homepage']
  s.author = package['author']
  s.source = { :git => package['repository']['url'], :tag => s.version.to_s }
  s.source_files = 'ios/**/*.{h,mm,swift}'
  # The Turbo Module's header pulls in the generated C++ spec, which a Swift importer of this pod must never see.
  s.private_header_files = 'ios/**/*.h'
  s.ios.deployment_target = '15.1'
  s.swift_version = '5.9'
  s.dependency 'HotCodePushCore'

  install_modules_dependencies(s)
end
