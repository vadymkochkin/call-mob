import React from 'react';
import { View, SafeAreaView, Button, StyleSheet } from 'react-native';

import { RTCPeerConnection, RTCView, mediaDevices } from 'react-native-webrtc';

import io from "socket.io-client";

const HOST = 'http://dev.herd.tips:3000';

const configuration = { iceServers: [{ url: 'stun:stun.l.google.com:19302' }] };
const localPC = new RTCPeerConnection(configuration);
const remotePC = new RTCPeerConnection(configuration);
const userId = new Date().getTime();

export default function App() {
  const [localStream, setLocalStream] = React.useState();
  const [remoteStream, setRemoteStream] = React.useState();
  const [cachedLocalPC, setCachedLocalPC] = React.useState();
  const [cachedRemotePC, setCachedRemotePC] = React.useState();
  const [socketObj, setSocketObj] = React.useState();

  const [isMuted, setIsMuted] = React.useState(false);

  const startLocalStream = async () => {
    initWebSocket();
    // isFront will determine if the initial camera should face user or environment
    const isFront = false;
    const devices = await mediaDevices.enumerateDevices();

    const facing = isFront ? 'front' : 'environment';
    const videoSourceId = devices.find(device => device.kind === 'videoinput' && device.facing === facing);
    const facingMode = isFront ? 'user' : 'environment';
    const constraints = {
      audio: true,
      video: {
        mandatory: {
          minWidth: 500, // Provide your own width, height and frame rate here
          minHeight: 300,
          minFrameRate: 30,
        },
        facingMode,
        optional: videoSourceId ? [{ sourceId: videoSourceId }] : [],
      },
    };
    const newStream = await mediaDevices.getUserMedia(constraints);
    setLocalStream(newStream);
  };

  const initWebSocket = () => {
    // Setup Socket
    const socket = io(HOST, {
      forceNew: true
    });

    socket.on("connect", () => console.log('connected'));

    socket.on("message", (msg) => {
      if (msg.call_data.type == 'offer' && msg.user != userId) {
        receiveOffer(msg.call_data);
      } else if (msg.call_data.type == 'answer' && msg.user != userId) {
        receiveAnswer(msg.call_data);
      } else {
        console.log('Unknown message:', msg);
      }
    });

    socket.on('joined', data => {
      console.log(data);
    })

    socket.emit('join', { roomID: 'only_me', user: userId });

    setSocketObj(socket);
  }

  receiveOffer = async (data) => {
    startCall();
    console.log('------------Receive Offer---------------');
    await remotePC.setRemoteDescription(data);
    console.log('RemotePC, createAnswer');
    const answer = await remotePC.createAnswer();
    console.log(`Answer from remotePC: ${answer.sdp}`);
    console.log('remotePC, setLocalDescription');
    await remotePC.setLocalDescription(answer);

    remotePC.onicecandidate = e => {
      try {
        console.log('remotePC icecandidate:', e);
        if (e.candidate) {
          localPC.addIceCandidate(e.candidate);
        }
      } catch (err) {
        console.error(`Error adding localPC iceCandidate: ${err}`);
      }
    };
    remotePC.onaddstream = e => {
      console.log('remotePC tracking with ', e);
      if (e.stream && remoteStream !== e.stream) {
        console.log('RemotePC received the stream', e.stream);
        setRemoteStream(e.stream);
      }
    };

    console.log('localPC, setRemoteDescription');
  	
    socketObj.emit('message', { call_data: answer, roomID: 'only_me', user: userId });
  }

  receiveAnswer = async (data) => {
    console.log('------------Receive answer---------------');
    await localPC.setRemoteDescription(data);
    await remotePC.setLocalDescription(data);
  }

  const startCall = async () => {
    // You'll most likely need to use a STUN server at least. Look into TURN and decide if that's necessary for your project


    // could also use "addEventListener" for these callbacks, but you'd need to handle removing them as well
    localPC.onicecandidate = e => {
      try {
        console.log('localPC icecandidate:', e);
        if (e.candidate) {
          remotePC.addIceCandidate(e.candidate);
        }
      } catch (err) {
        console.error(`Error adding remotePC iceCandidate: ${err}`);
      }
    };

    remotePC.onicecandidate = e => {
      try {
        console.log('remotePC icecandidate:', e);
        if (e.candidate) {
          localPC.addIceCandidate(e.candidate);
        }
      } catch (err) {
        console.error(`Error adding localPC iceCandidate: ${err}`);
      }
    };
    remotePC.onaddstream = e => {
      console.log('remotePC tracking with ', e);
      if (e.stream && remoteStream !== e.stream) {
        console.log('RemotePC received the stream', e.stream);
        setRemoteStream(e.stream);
      }
    };


    // AddTrack not supported yet, so have to use old school addStream instead
    // newStream.getTracks().forEach(track => localPC.addTrack(track, newStream));
    localPC.addStream(localStream);
    try {
      const offer = await localPC.createOffer();
      console.log('Offer from localPC, setLocalDescription');
      await localPC.setLocalDescription(offer);

      setCachedLocalPC(localPC);
      setCachedRemotePC(remotePC);

      socketObj.emit('message', { call_data: offer, roomID: 'only_me', user: userId });

    } catch (err) {
      console.error(err);
    }

  };

  const switchCamera = () => {
    localStream.getVideoTracks().forEach(track => track._switchCamera());
  };

  // Mutes the local's outgoing audio
  const toggleMute = () => {
    if (!remoteStream) return;
    localStream.getAudioTracks().forEach(track => {
      console.log(track.enabled ? 'muting' : 'unmuting', ' local track', track);
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    });
  };

  const closeStreams = () => {
    if (cachedLocalPC) {
      cachedLocalPC.removeStream(localStream);
      cachedLocalPC.close();
    }
    if (cachedRemotePC) {
      cachedRemotePC.removeStream(remoteStream);
      cachedRemotePC.close();
    }
    setLocalStream();
    setRemoteStream();
    setCachedRemotePC();
    setCachedLocalPC();
  };

  return (
    <SafeAreaView style={styles.container}>
      {!localStream && <Button title="Click to start stream" onPress={startLocalStream} />}
      {localStream && <Button title="Click to start call" onPress={startCall} disabled={!!remoteStream} />}

      {localStream && (
        <View style={styles.toggleButtons}>
          <Button title="Switch camera" onPress={switchCamera} />
          <Button title={`${isMuted ? 'Unmute' : 'Mute'} stream`} onPress={toggleMute} disabled={!remoteStream} />
        </View>
      )}

      <View style={styles.rtcview}>
        {localStream && <RTCView style={styles.rtc} streamURL={localStream.toURL()} />}
      </View>
      <View style={styles.rtcview}>
        {remoteStream && <RTCView style={styles.rtc} streamURL={remoteStream.toURL()} />}
      </View>
      <Button title="Click to stop call" onPress={closeStreams} disabled={!remoteStream} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#313131',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: '100%',
  },
  text: {
    fontSize: 30,
  },
  rtcview: {
    justifyContent: 'center',
    alignItems: 'center',
    height: '40%',
    width: '80%',
    backgroundColor: 'black',
  },
  rtc: {
    width: '80%',
    height: '100%',
  },
  toggleButtons: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
});
