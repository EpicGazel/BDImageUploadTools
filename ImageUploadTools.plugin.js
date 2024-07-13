/**
 * @name ImageUploadTools
 * @version 0.0.2
 * @description Automatically convert uploaded images to another format, shrink dimensions, or ensure below max file size.
 * @author Gazel
 * @source https://github.com/EpicGazel/BDImageUploadTools
 * @updateUrl https://raw.githubusercontent.com/EpicGazel/BDImageUploadTools/main/ImageUploadTools.plugin.js
 * @website ...
 * @donate https://ko-fi.com/gazel
 */

const Api = new BdApi("ImageUploadTools");

var mySettings = {
    //List dictionary of what format to convert images to
    //Dict key & value must match mime type, careful with case jpeg (not jpg)
    imageFormats: {
        'image/avif': 'image/webp',
        //'image/png': 'image/webp',
        //'image/jpeg': 'image/webp',
        //'image/webp': 'image/webp',
    },
    imageQuality: 0.9, // 0.0 - 1.0, only for jpeg and webp
    imageMaxFileSize: Infinity, //24.5 * 1000 * 1000, //in bytes, non-nitro limit is 25MB
    imageMinFileSize: 0, // Minimum file size (in bytes) to be converted, to disabled, set to 0
    maxShrinkIterationLimit: 15,
    strictDimensionLimit: false, // If true, image will be resized if it is larger than the max width or height
    imageMaxWidth: 1920,
    imageMaxHeight: 1920,
}

/* //Fledgling Settings 
const FormSwitch = Api.Webpack.getByKeys("FormSwitch").FormSwitch;
const FormSlider = Api.Webpack.getByKeys("FormSlider").FormSlider;

var pluginSettings = {
    imageQuality: {
        name: "Image Quality",
        note: "0.0 - 1.0 (Higher is better, only effects jpeg and webp)",
        value: 0.9,
        type: FormSlider
    },
    maxShrinkIterationLimit: {
        name: "Max Shrink Iteration Limit",
        note: "The limit for the number of times the image will be resized if it is larger than the max width or height",
        value: 15,
        type: FormSlider
    },
    strictDimensionLimit: {
        name: "Strict Dimension Limit",
        note: "If true, image will be resized if it is larger than the max width or height (even if it is smaller than the max file size).",
        value: false,
        type: FormSwitch
    },
    imageMaxFileSizePreMultiply : {
        name: "Max File Size",
        note: "The maximum file size in units.",
        value: 1000,
        type: FormSlider
    },
    imageMaxFileSizeUnits: {
        // Units can be b (bytes), kb (1000), mb (1000000), or gb (1000000000)
        name: "Max File Size Units",
        note: "The maximum file size units.",
        value: "kb",
        type: FormDropdown,
        options: [
            { label: "Bytes", value: 1 },
            { label: "KB", value: 1000 },
            { label: "MB", value: 1000 * 1000 },
            { label: "GB", value: 1000 * 1000 * 1000 }
        ]
    }
};
*/

// https://stackoverflow.com/a/23202637
const map = (num, in_min, in_max, out_min, out_max) => (num - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;

module.exports = (Plugin, Library) => ({
    async start() {
        // Patching the addFiles method of MessageAttachmentManager
        const {byProps} = Api.Webpack.Filters;
        const MessageAttachmentManager = Api.Webpack.getModule(byProps("addFiles"));
        const moduleFileCheck = global.BdApi.findModuleByProps('anyFileTooLarge', 'maxFileSize');

        async function convertImage(originalImage, iteration = 0, quality = mySettings.imageQuality, width = null, height = null) {
            console.log(`Convert Image Function, iteration: ${iteration}, quality: ${quality}, width: ${width}, height: ${height}`);
            try {
                const fromMimeType = originalImage.file.type;
                const toMimeType = mySettings.imageFormats[fromMimeType];
                // Get extension by going from last '.' to end
                const fromExtension = originalImage.file.name.slice(originalImage.file.name.lastIndexOf('.'));
                const toExtension = '.' + toMimeType.split('image/').pop();

                const originalImageBlob = new Blob([await originalImage.file.arrayBuffer()], { type: fromMimeType });
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
        
                const outputImageBlob = await new Promise((resolve, reject) => {
                    const img = new Image();
                    img.onload = function () {
                        if (mySettings.strictDimensionLimit) {
                            if (img.width > mySettings.imageMaxWidth || img.height > mySettings.imageMaxHeight) {
                                const widthRatio = mySettings.imageMaxWidth / img.width;
                                const heightRatio = mySettings.imageMaxHeight / img.height;
        
                                if (widthRatio < heightRatio) {
                                    width = mySettings.imageMaxWidth;
                                    height = Math.round(img.height * widthRatio);
                                } else {
                                    height = mySettings.imageMaxHeight;
                                    width = Math.round(img.width * heightRatio);
                                }

                                console.log(`Using strict dimension limit: ${img.width}x${img.height} -> ${width}x${height}`);
                            }
                            
                        }

                        canvas.width = width ? width : img.width;
                        canvas.height = height ? height : img.height;
                        
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                        const dataURL = (width && height) ? canvas.toDataURL(toMimeType) : canvas.toDataURL(toMimeType, quality);

                        const base64 = dataURL.split(',')[1];
                        const outputImageBlob = b64toBlob(base64, toMimeType);
                        resolve(outputImageBlob);
                    };
                    img.src = URL.createObjectURL(originalImageBlob);
                });
        
                const file = new File([outputImageBlob], originalImage.file.name.replace(fromExtension, toExtension), { type: toMimeType });
                let outputImageFile = {
                    file: file,
                    isThumbnail: originalImage.isThumbnail,
                    platform: originalImage.platform
                };
                console.log('outputImageFile:', outputImageFile);

                if (outputImageFile.file.size > mySettings.imageMaxFileSize && iteration < mySettings.maxShrinkIterationLimit) {
                    console.log(`Converted image size ${outputImageFile.file.size} exceeds max size ${mySettings.imageMaxFileSize}.`);

                    if (toMimeType === 'image/jpeg' || toMimeType === 'image/webp') {
                        const reductionRatio = map(mySettings.imageMaxFileSize / outputImageFile.file.size, 0.0, 1.0, 0.5, 0.92);
                        const newQuality = quality * reductionRatio;
                        console.log(`Rerunning conversion with quality ${mySettings.imageQuality}->${newQuality.toFixed(2)}.`);
                        outputImageFile = await convertImage(originalImage, iteration + 1, newQuality);
                    } else {
                        const reductionRatio = map(mySettings.imageMaxFileSize / outputImageFile.file.size, 0.0, 1.0, 0.5, 0.92);
                        const newWidth = Math.round(canvas.width * reductionRatio);
                        const newHeight = Math.round(canvas.height * reductionRatio);
                        console.log(`Rerunning conversion with width ${canvas.width}->${newWidth}, height ${canvas.height}->${newHeight}.`);
                        outputImageFile = await convertImage(originalImage, iteration + 1, 1, newWidth, newHeight);
                    }
                }

                if (iteration >= mySettings.maxShrinkIterationLimit)
                    console.log(`Max shrink iteration limit reached. Conversion stopped short after ${iteration} iterations.`);

                return outputImageFile;
            } catch (error) {
                console.error('Error converting image:', error);
                return originalImage; // Return the original file in case of an error
            }
        }
        
        // Helper function to convert base64 to Blob
        function b64toBlob(base64, type = 'application/octet-stream') {
            const byteCharacters = atob(base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            return new Blob([byteArray], { type: type });
        }

        // TODO: Override moduleFileCheck maxFileSize check, images greater than size can simply be converted or shrunk
        // See https://github.com/mack/magic-upload/blob/main/index.js

        // Patching the addFiles method to include AVIF conversion
        Api.Patcher.instead(MessageAttachmentManager, "addFiles", (_, [{files, channelId}], original) => {
            console.log("Adding and converting files...");

            for (const file of files) {
                console.log(`File: ${file.file.name} (${file.file.type})`);
            }
            const convertedFilesPromises = files.map(async (file) => {
                // Check if the file type is in the list of supported formats
                if (mySettings.imageFormats[file.file.type] && file.file.size >= mySettings.imageMinFileSize) {
                    // Convert AVIF to WebP format
                    console.log(`Converting image ${file.file.type} -> ${mySettings.imageFormats[file.file.type]}`);
                    try {
                        const convertedFile = await convertImage(file);
                        return convertedFile;
                    } catch (error) {
                        console.error("Error converting image:", error);
                        return file;
                    }
                } else {
                    if (!mySettings.imageFormats[file.file.type])
                        console.log(`Skipping image, file type ${file.file.type} is not in imageFormats list...`);
                    else if (file.file.size < mySettings.imageMinFileSize)
                        console.log(`Skipping image, file size ${file.file.size} is less than min size ${mySettings.imageMinFileSize}...`);
                    return file;
                }
            });

            // Wait for all conversion promises to resolve
            Promise.all(convertedFilesPromises).then((convertedFiles) => {
                // Call the original method with the modified files
                original({
                    files: convertedFiles,
                    channelId: channelId,
                    showLargeMessageDialog: false,
                    draftType: 0
                });
            }).catch((error) => {
                console.error("Error converting image:", error);
                // Call the original method with the original files in case of error
                original({
                    files: files,
                    channelId: channelId,
                    showLargeMessageDialog: false,
                    draftType: 0
                });
            });
        });
    },
    stop() {
        Api.Patcher.unpatchAll();
    }
});
