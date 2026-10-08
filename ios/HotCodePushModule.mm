#import "HotCodePushModule.h"

#import <React/RCTInvalidating.h>

#if __has_include(<HotcodepushReactNativeCodePush/HotcodepushReactNativeCodePush-Swift.h>)
#import <HotcodepushReactNativeCodePush/HotcodepushReactNativeCodePush-Swift.h>
#else
#import "HotcodepushReactNativeCodePush-Swift.h"
#endif

@interface HotCodePushModule () <HotCodePushEventSink, RCTInvalidating>
@end

@implementation HotCodePushModule

- (instancetype)init
{
  if (self = [super init]) {
    [HotCodePushRuntime.shared attach:self];
  }
  return self;
}

/// A reload ends this module's JavaScript and the callback its emit methods call: the runtime stops emitting through it.
- (void)invalidate
{
  [HotCodePushRuntime.shared detach:self];
}

+ (NSString *)moduleName
{
  return @"HotCodePush";
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeHotCodePushSpecJSI>(params);
}

#pragma mark - Methods

- (void)applyUpdate:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"applyUpdate" options:@{} resolve:resolve reject:reject];
}

- (void)checkForUpdate:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"checkForUpdate" options:@{} resolve:resolve reject:reject];
}

- (void)clearUpdates:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"clearUpdates" options:@{} resolve:resolve reject:reject];
}

- (void)consumeUpdateRolledBack:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"consumeUpdateRolledBack" options:@{} resolve:resolve reject:reject];
}

- (void)downloadUpdate:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"downloadUpdate" options:@{} resolve:resolve reject:reject];
}

- (void)getChannel:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"getChannel" options:@{} resolve:resolve reject:reject];
}

- (void)getDevice:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"getDevice" options:@{} resolve:resolve reject:reject];
}

- (void)getState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"getState" options:@{} resolve:resolve reject:reject];
}

- (void)notifyReady:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"notifyReady" options:@{} resolve:resolve reject:reject];
}

- (void)rollbackUpdate:(NSDictionary *)options
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"rollbackUpdate" options:options resolve:resolve reject:reject];
}

- (void)setAttributes:(NSDictionary *)options
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"setAttributes" options:options resolve:resolve reject:reject];
}

- (void)setChannel:(NSDictionary *)options resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"setChannel" options:options resolve:resolve reject:reject];
}

- (void)setRestartAllowed:(NSDictionary *)options
                  resolve:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"setRestartAllowed" options:options resolve:resolve reject:reject];
}

- (void)showDebugScreen:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"showDebugScreen" options:@{} resolve:resolve reject:reject];
}

- (void)sync:(NSDictionary *)options resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self invoke:@"sync" options:options resolve:resolve reject:reject];
}

- (void)invoke:(NSString *)methodName
       options:(NSDictionary *)options
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  [HotCodePushRuntime.shared invoke:methodName
                            options:options
                            resolve:resolve
                             reject:^(NSString *message) {
                               reject(@"HotCodePush", message, nil);
                             }];
}

#pragma mark - HotCodePushEventSink

- (void)emitEvent:(NSString *)eventName payload:(NSDictionary<NSString *, id> *)payload
{
  // React Native hands the module its emitter callback after init; an event before that has no JavaScript listening yet.
  if (!_eventEmitterCallback) {
    return;
  }
  if ([eventName isEqualToString:@"downloadProgress"]) {
    [self emitOnDownloadProgress:payload];
  } else if ([eventName isEqualToString:@"updateAvailable"]) {
    [self emitOnUpdateAvailable:payload];
  } else if ([eventName isEqualToString:@"updateDownloaded"]) {
    [self emitOnUpdateDownloaded:payload];
  } else if ([eventName isEqualToString:@"updateFailed"]) {
    [self emitOnUpdateFailed:payload];
  }
}

@end
