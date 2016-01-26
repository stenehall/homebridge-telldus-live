var types = require("hap-nodejs/accessories/types.js");
var TellduAPI = require("telldus-live");
var Characteristic = require("hap-nodejs").Characteristic;
var Service = require("hap-nodejs").Service;

function TelldusLivePlatform(log, config) {
  var that = this;
  that.log = log;

  that.isLoggedIn = false;

  // Login to Telldus Live!
  that.cloud = new TellduAPI.TelldusAPI({publicKey: config["public_key"], privateKey: config["private_key"]})
    .login(config["token"], config["token_secret"], function(err, user) {
      if (!!err) that.log("Login error: " + err.message);
      that.log("User logged in: " + user.firstname + " " + user.lastname + ", " + user.email);
      that.isLoggedIn = true;
    }
    );
}

TelldusLivePlatform.prototype = {

  accessories: function(callback) {
    var that = this;

    that.log("Fetching devices...");
    var foundAccessories = [];
    var devices = [];
    var sensors = [];
    that.cloud.getDevices(function(devicesErr, devices) {
      that.cloud.getSensors(function(sensorsErr, sensors) {
        if (!!devicesErr && !!sensorsErr) return that.log('getDevices: ' + devicesErr.message  + ' getSensors: ' + sensorsErr.message);

        // Clean non device
        for (var i = 0; i < devices.length; i++) {
          if (devices[i].type != 'device') {
            devices.splice(i, 1);
          }
        }

        for (var i = 0; i < devices.length; i++) {
          if (devices[i].type === 'device') {
            TelldusLiveAccessory.create(that.log, devices[i], that.cloud, function(err, accessory) {
              if (!!err) that.log("Couldn't load device info");
              foundAccessories.push(accessory);
              if (foundAccessories.length >= (devices.length + sensors.length)) {
                callback(foundAccessories);
              }
            });
          }
        }

        // Clean non device
        for (var i = 0; i < sensors.length; i++) {
          // We're currently only supporting temperaturehumidity sensors;
          if (sensors[i].model !== 'temperaturehumidity') {
            sensors.splice(i, 1);
          } else {
            sensors[i].type = sensors[i].model;
            sensors[i].model = sensors[i].model+':unknown';
          }
        }

        for (var i=0; i < sensors.length; i++) {
          TelldusLiveAccessory.create(that.log, sensors[i], that.cloud, function(err, accessory) {
            if (!!err) that.log("Couldn't load device info");
            foundAccessories.push(accessory);
            if (foundAccessories.length >= (devices.length + sensors.length)) {
              callback(foundAccessories);
            }
          });
        }
      });
    });
  }
};

var TelldusLiveAccessory = function TelldusLiveAccessory(log, cloud, device) {

  this.log   = log;
  this.cloud = cloud;

  var m = device.model.split(':');

  // Set accessory info
  this.device         = device;
  this.id             = device.id;
  this.name           = device.name;
  this.manufacturer   = m[1];
  this.model          = m[0];
  this.state          = device.state;
  this.stateValue     = device.stateValue;
  this.status         = device.status;
  this.value          = device.status === 'on' ? 1 : 0;
};

TelldusLiveAccessory.create = function (log, device, cloud, callback) {

  if (device.type == 'temperaturehumidity') {
    cloud.getSensorInfo(device, function(err, fetchedDevice) {
      if (!!err) that.log("Couldn't load device info");
      fetchedDevice.type = device.type;
      fetchedDevice.model = device.model;
      callback(err, new TelldusLiveAccessory(log, cloud, fetchedDevice));
    });
  } else {
    cloud.getDeviceInfo(device, function(err, device) {
      if (!!err) that.log("Couldn't load device info");
      callback(err, new TelldusLiveAccessory(log, cloud, device));
    });
  }
};

TelldusLiveAccessory.prototype = {

  dimmerValue: function() {
    if (this.device.state === 1) {
      return 100;
    }
    if (this.device.state == 16 && this.device.statevalue != "unde") {
      return parseInt(this.device.statevalue * 100 / 255);
    }

    return 0;
  },

  getServices: function() {
    var informationService = new Service.AccessoryInformation();
    var objectService;
    var that = this;

    if (that.device.type !== 'temperaturehumidity') {
      informationService
        .setCharacteristic(Characteristic.Manufacturer, that.manufacturer)
        .setCharacteristic(Characteristic.Model, that.model)
        .setCharacteristic(Characteristic.SerialNumber, 'A1S2NASF88EW');

      objectService = new Service.Lightbulb();
      objectService.getCharacteristic(Characteristic.On)
        .on('set', function(value, callback) {
          that.cloud.onOffDevice(that.device, value, function(err, result) {
            if (!!err) {
              that.log("Error: " + err.message)
            } else {
              that.log(that.name + " - Updated power state: " + (value == 1 ? 'ON' : 'OFF'));
              callback();
            }
          });
        });

      objectService
        .getCharacteristic(Characteristic.On)
        .on('get', function(callback) {
          that.cloud.getDeviceInfo(that.device, function(err, device) {
            if (!!err) that.log("Couldn't load device info");

            that.device = device;
            callback(null, that.device.status === 'on' ? 1 : 0);
          });
        });

      if (that.model === "selflearning-dimmer") {
        objectService
          .addCharacteristic(new Characteristic.Brightness())
          .on('get', function(callback) {
            that.cloud.getDeviceInfo(that.device, function(err, device) {
              if (!!err) that.log("Couldn't load device info");

              that.device = device;
              var value = that.dimmerValue();
              callback(null, value);
            });
          });

        objectService
          .getCharacteristic(Characteristic.Brightness)
          .on('set', function(value, callback) {
            that.cloud.dimDevice(that.device, (255 * (value / 100)), function (err, result) {
              if (!!err) {
                that.log("Error: " + err.message);
              } else {
                that.log(that.name + " - Updated brightness: " + value);
              }
            });
            callback();
          });
      }
    }

    if (this.device.type === 'temperaturehumidity') {
      var that = this;
      informationService
        .setCharacteristic(Characteristic.Manufacturer, "Temperature Manufacturer")
        .setCharacteristic(Characteristic.Model, "Temperature Thermometer")
        .setCharacteristic(Characteristic.SerialNumber, "Temperature Serial Number");

      var objectService = new Service.TemperatureSensor();
      objectService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({
          minValue: -100,
          value: 10
        })
      .on('get', function(callback) {
        that.cloud.getSensorInfo(that.device, function(err, sensor) {
          if(err) {
            return;
          }
          var tmp = Number(sensor.data[0].value);
          that.log("Current temperature: " + tmp);
          callback(null, tmp);
        });
      });
    }
    return [informationService, objectService];
  }
};

module.exports.platform = TelldusLivePlatform;
module.exports.accessory = TelldusLiveAccessory;
