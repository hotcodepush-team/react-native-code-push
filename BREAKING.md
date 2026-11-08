# Breaking Changes

This is a comprehensive list of the breaking changes introduced in the minor version releases while the package is on `0.x`.

## Versions

- [Version 0.2.x](#version-02x)

## Version 0.2.x

### setAttributes takes an options object

`setAttributes()` takes one options object with the attributes under `attributes`, like every other method:

```diff
- await HotCodePush.setAttributes({ plan: 'enterprise', userId: '42' });
+ await HotCodePush.setAttributes({ attributes: { plan: 'enterprise', userId: '42' } });
```
