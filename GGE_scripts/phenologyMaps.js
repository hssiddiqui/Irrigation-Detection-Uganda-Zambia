// select 3 years of MODIS imagery
var roi = ee.FeatureCollection("FAO/GAUL/2015/level0") 
              .filter(ee.Filter.eq('ADM0_NAME','Uganda'));
var collection = ee.ImageCollection("MODIS/061/MOD13Q1");
collection = collection.filterBounds(roi)
                .filterDate('2015-01-01', '2018-01-01');

collection = collection.select('EVI');

//scale the values from -2000 to 10000 to 0 to 255
var scale = function(image){
  image = image.divide(10000);
  image = image.unitScale(-0.2, 1.0);
  return image.multiply(255);
};

collection = collection.map(scale);
print(collection);

// define the temporal endmembers for 3 years (69 images)
var Red = [80.1,72.5,72.8,79.9,85.6,94.4,118.2,145.9,155.2,
          156.3,151.4,149.1,144.5,144.3,142.7,143.5,138.3,
          132.4,124.5,127.6,116.6,110,95.2,88,78.4,74.7,
          75.8,82.5,97.2,109.7,135.6,154,150.6,145.6,153.3,
          153.8,152.5,148.9,142.5,143.5,141,127.1,118.7,
          110.3,95.5,81.3,75.8,69.4,71.5,79.2,83.5,91.6,
          99.8,113.7,137,146,154.6,151.5,149.8,157.2,160.5,
          152.9,145.8,144.2,142.4,130.8,121.4,104.8,84.6];
var Green = [128.9,133.6,128.3,147.7,132.2,131.6,138.2,
          147.2,146.7,142.1,132.3,141.8,136.7,148.8,150.8,
          147.3,152.6,143.3,121.4,145.7,139.2,139,132.3,
          132.3,122.5,126.6,119.3,141.2,154.2,138.7,138.5,
          150.5,144.7,138.1,138.4,138.8,133.2,143.7,127.2,
          141.8,149.1,130.7,138.3,145.6,141.8,128.3,138.3,
          135.8,135.5,141.2,136.8,141.9,148.3,133.8,151.3,
          143.9,142.9,142.6,129.4,145.5,143.5,154,138.1,
          136.7,128.6,134.4,138.5,133.6,128.5];
var Blue = [119.4,98.2,95,90.3,91.3,98.2,132.8,147.4,158.1,
          157.6,148.2,142.2,129.3,127.6,119.4,116.5,121.2,
          128.5,146.5,150.2,153,152.2,139.2,134.1,119.3,
          109.9,97.3,99.8,108.8,125.2,137.9,150.4,141.9,
          131.5,130.9,121.2,121.5,119.4,112.7,113.2,137.1,
          132.1,140.8,140.9,133.3,115.1,100,91.7,87.4,
          101.1,102,112.8,116.6,126.8,140.4,128.9,122.2,
          115.7,113.5,121.2,129,132.5,134.4,143.9,152.2,
          150.2,143,128.1,111.8];
var Dark = [63.7,61.3,60.7,60.5,60.2,61.7,63.4,68.1,65.8,
          64.6,63.6,62.8,61.7,61.8,60.7,60.3,60.2,60.1,
          60.6,65.4,68.4,73.2,68.9,64.6,63.2,60.4,59.9,
          60.9,62.6,63.3,65.9,73.6,71.2,68,68.1,65.3,65.9,
          65.4,62.8,62.9,61.1,60.9,60.5,60.8,60.4,59.8,
          59.8,59.3,60.2,59.9,59.9,61,60.2,61,62.8,63.8,
          63,61.8,63.3,64.5,62.6,65,64.2,63.3,69.3,74.4,
          70.1,66.1,64.3];
          
//collapse the stack into a multi-band raster          
var modisEVI = collection.toBands();
print(modisEVI);

//unmix the image using the unit sum constraint
var tEMs = modisEVI.unmix({endmembers: [Red, Green, Blue, Dark],
                        sumToOne: true,
                        nonNegative: false
});

tEMs = tEMs.rename(['Red', 'Green', 'Blue', 'Dark']);
print(tEMs);

// create an ee.Geometry.
var polygon = ee.Geometry.Polygon([
  [[29.356, 4.45], [35.785,4.45], [35.785,0.0157], [29.356,0.0157]]
]);

tEMs=tEMs.clip(roi);

// Add the black background to the map
var black = ee.Image.constant([0, 0, 0]).rename(['R', 'G', 'B']).visualize({
  min: 0,
  max: 255,
  opacity: 1
});
Map.addLayer(black, {}, 'Black Background');

//Add Temporal Mixture Map
Map.addLayer(tEMs, {min: 0, max:1}, "Temporal Mixture Map");
Map.centerObject(roi);

var modisEVIClip = modisEVI.clipToBoundsAndScale(polygon)


Export.image.toDrive({
  image: modisEVIClip,
  description: 'MODIS_GEE_EVI',
  folder: 'earthengineMODIS',
  fileFormat: 'GEOTIFF'
  })
