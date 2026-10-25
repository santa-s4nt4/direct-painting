import Foundation
import CoreMIDI
// Isolated virtual source: emits only to clients explicitly selecting this port.
var client = MIDIClientRef(), source = MIDIEndpointRef()
guard MIDIClientCreate("direct-painting test" as CFString,nil,nil,&client) == noErr,
      MIDISourceCreate(client,"direct-painting TEST INPUT" as CFString,&source) == noErr else { exit(1) }
var uid = MIDIUniqueID(); MIDIObjectGetIntegerProperty(source,kMIDIPropertyUniqueID,&uid)
print(uid); fflush(stdout)
while let line = readLine() {
 let bytes = line.split(separator:" ").compactMap{UInt8($0)}
 if bytes.isEmpty { continue }
 var packets = MIDIPacketList()
 withUnsafeMutablePointer(to:&packets) { list in
  let packet = MIDIPacketListInit(list)
  bytes.withUnsafeBufferPointer { _ = MIDIPacketListAdd(list,MemoryLayout<MIDIPacketList>.size,packet,0,bytes.count,$0.baseAddress!) }
  MIDIReceived(source,list)
 }
 print("sent \(bytes)"); fflush(stdout)
}
MIDIEndpointDispose(source); MIDIClientDispose(client)
