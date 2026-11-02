import { mergeContents, removeContents } from '@expo/config-plugins/build/utils/generateCode'

import { DIRECTORY } from './storage-paths'

const TAG = '@fishonfire/bubbles-expo-installation-backup-exclusions'

const SWIFT_BACKUP_EXCLUSIONS = `do {
      let bubblesDocuments = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      var bubblesDirectory = bubblesDocuments.appendingPathComponent("${DIRECTORY}", isDirectory: true)
      try FileManager.default.createDirectory(at: bubblesDirectory, withIntermediateDirectories: true, attributes: nil)
      var bubblesValues = URLResourceValues()
      bubblesValues.isExcludedFromBackup = true
      try bubblesDirectory.setResourceValues(bubblesValues)
      // Protect existing root files before JavaScript's lazy migration runs.
      for var bubblesLegacyFile in try FileManager.default.contentsOfDirectory(at: bubblesDocuments, includingPropertiesForKeys: nil) {
        let bubblesName = bubblesLegacyFile.lastPathComponent
        if bubblesName.hasPrefix("bubbles-notifications-") || bubblesName == "device-id.txt" {
          try bubblesLegacyFile.setResourceValues(bubblesValues)
        }
      }
    } catch {
      fatalError("[BubblesNotifications] Cannot exclude installation storage from backup: \\(error)")
    }`

const OBJC_BACKUP_EXCLUSIONS = `NSURL *bubblesDocuments = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
  NSURL *bubblesDirectory = [bubblesDocuments URLByAppendingPathComponent:@"${DIRECTORY}" isDirectory:YES];
  NSError *bubblesBackupError = nil;
  if (![[NSFileManager defaultManager] createDirectoryAtURL:bubblesDirectory withIntermediateDirectories:YES attributes:nil error:&bubblesBackupError] ||
      ![bubblesDirectory setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:&bubblesBackupError]) {
    @throw [NSException exceptionWithName:@"BubblesBackupExclusionError" reason:[bubblesBackupError localizedDescription] userInfo:nil];
  }
  NSArray<NSURL *> *bubblesLegacyFiles = [[NSFileManager defaultManager] contentsOfDirectoryAtURL:bubblesDocuments includingPropertiesForKeys:nil options:0 error:&bubblesBackupError];
  if (bubblesLegacyFiles == nil) {
    @throw [NSException exceptionWithName:@"BubblesBackupExclusionError" reason:[bubblesBackupError localizedDescription] userInfo:nil];
  }
  for (NSURL *bubblesLegacyFile in bubblesLegacyFiles) {
    NSString *bubblesName = bubblesLegacyFile.lastPathComponent;
    if (([bubblesName hasPrefix:@"bubbles-notifications-"] || [bubblesName isEqualToString:@"device-id.txt"]) &&
        ![bubblesLegacyFile setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:&bubblesBackupError]) {
      @throw [NSException exceptionWithName:@"BubblesBackupExclusionError" reason:[bubblesBackupError localizedDescription] userInfo:nil];
    }
  }`

export function updateAppDelegateBackupExclusions (contents: string, language: string): string {
  let src = removeContents({ src: contents, tag: TAG }).contents
  const swift = language === 'swift'

  if (swift && !/^\s*import Foundation\s*$/m.test(src)) {
    src = `import Foundation\n${src}`
  }

  if (!swift && language !== 'objc' && language !== 'objcpp') {
    throw new Error(`[BubblesNotifications] Unsupported AppDelegate language: ${language}`)
  }

  const method = swift
    ? /func\s+application\([^)]*didFinishLaunchingWithOptions[^)]*\)\s*->\s*Bool\s*\{/.exec(src)
    : /-\s*\(BOOL\)\s*application:\s*\(UIApplication\s*\*\s*\)\w+[^;{]*didFinishLaunchingWithOptions:[^;{]*\{/.exec(src)

  if (!method) {
    throw new Error('[BubblesNotifications] Cannot find AppDelegate launch method to protect installation storage.')
  }

  return mergeContents({
    tag: TAG,
    src,
    newSrc: swift ? SWIFT_BACKUP_EXCLUSIONS : OBJC_BACKUP_EXCLUSIONS,
    // mergeContents matches one line at a time; insert after the located brace.
    anchor: /^/,
    offset: src.slice(0, method.index + method[0].length).split('\n').length,
    comment: '//'
  }).contents
}
