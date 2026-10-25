import Foundation
import CoreMIDI

// Read-only CoreMIDI input. No output ports or SysEx commands are created.
let output = DispatchQueue(label: "direct-painting.midi-output")
func emit(_ value: [String: Any]) {
    output.async {
        if let data = try? JSONSerialization.data(withJSONObject: value) {
            FileHandle.standardOutput.write(data + Data([10]))
        }
    }
}
func property(_ object: MIDIObjectRef, _ key: CFString) -> String {
    var value: Unmanaged<CFString>?
    return MIDIObjectGetStringProperty(object, key, &value) == noErr ? (value?.takeRetainedValue() as String? ?? "MIDI input") : "MIDI input"
}
func uid(_ object: MIDIObjectRef) -> MIDIUniqueID {
    var value: MIDIUniqueID = 0
    MIDIObjectGetIntegerProperty(object, kMIDIPropertyUniqueID, &value)
    return value
}
var client = MIDIClientRef(), port = MIDIPortRef(), connected = MIDIEndpointRef()
var selected = "", lastDevices = ""
func refresh() {
    var devices = [[String: String]]()
    var endpoint = MIDIEndpointRef()
    for i in 0..<MIDIGetNumberOfSources() {
        let source = MIDIGetSource(i), id = String(uid(source))
        devices.append(["id": id, "name": property(source, kMIDIPropertyDisplayName)])
        if id == selected { endpoint = source }
    }
    if connected != endpoint {
        if connected != 0 { MIDIPortDisconnectSource(port, connected) }
        connected = 0
        if endpoint != 0 {
            let result = MIDIPortConnectSource(port, endpoint, UnsafeMutableRawPointer(bitPattern: Int(uid(endpoint))))
            if result == noErr { connected = endpoint }
            else { emit(["type":"error", "message":"MIDI input connection failed (\(result))"]) }
        }
    }
    let signature = String(describing: devices) + selected + String(connected)
    if signature != lastDevices {
        lastDevices = signature
        emit(["type":"devices", "devices":devices, "connected": connected != 0, "selected":selected])
    }
}
let result = MIDIClientCreateWithBlock("direct-painting" as CFString, &client) { _ in
    DispatchQueue.main.async { refresh() }
}
guard result == noErr else { emit(["type":"error", "message":"CoreMIDI client failed (\(result))"]); exit(1) }
let inputResult = MIDIInputPortCreateWithBlock(client, "Timeline input" as CFString, &port) { packets, context in
    let sourceID = String(Int(bitPattern: context))
    var packet = UnsafeRawPointer(packets).advanced(by: MemoryLayout<MIDIPacketList>.offset(of: \.packet)!).assumingMemoryBound(to: MIDIPacket.self)
    for _ in 0..<packets.pointee.numPackets {
        let count = Int(packet.pointee.length)
        let data = UnsafeRawPointer(packet).advanced(by: MemoryLayout<MIDIPacket>.offset(of: \.data)!).assumingMemoryBound(to: UInt8.self)
        let bytes = Array(UnsafeBufferPointer(start: data, count: count))
        emit(["type":"data", "id":sourceID, "bytes":bytes])
        packet = UnsafePointer(MIDIPacketNext(packet))
    }
}
guard inputResult == noErr else { emit(["type":"error", "message":"CoreMIDI input failed (\(inputResult))"]); exit(1) }
refresh()
DispatchQueue.global().async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8), let command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let id = command["id"] as? String else { continue }
        DispatchQueue.main.async { selected = id; refresh() }
    }
    exit(0)
}
RunLoop.main.run()
