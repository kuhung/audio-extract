document.addEventListener('DOMContentLoaded', () => {
    const { FFmpeg } = FFmpeg;
    let ffmpeg;

    // --- DOM Elements ---
    const dropArea = document.getElementById('drop-area');
    const fileInput = document.getElementById('file-input');
    const fileList = document.getElementById('file-list');
    const noFilesSelected = document.getElementById('no-files-selected');
    
    const speedInput = document.getElementById('speed-input');
    const downsampleCheck = document.getElementById('downsample-check');
    const splitCheck = document.getElementById('split-check');
    const splitOptions = document.getElementById('split-options');
    const customSplitInput = document.getElementById('custom-split-input');

    const startBtn = document.getElementById('start-btn');
    const progressBar = document.getElementById('progress-bar');
    const progressLabel = document.getElementById('progress-label');
    const ffmpegStatusLabel = document.getElementById('ffmpeg-status-label');
    const logOutput = document.getElementById('log-output');
    
    const outputArea = document.getElementById('output-area');
    const downloadLinks = document.getElementById('download-links');

    let selectedFiles = [];

    // --- FFmpeg Setup ---
    const setupFFmpeg = async () => {
        try {
            ffmpeg = new FFmpeg();
            ffmpeg.on('log', ({ message }) => {
                log(message);
            });
            ffmpeg.on('progress', ({ progress, time }) => {
                const percentage = Math.round(progress * 100);
                updateProgress(percentage, `处理中... ${percentage}%`);
            });
            updateFfmpegStatus('FFmpeg 未加载', false);
            await loadFFmpeg();
        } catch (error) {
            console.error(error);
            updateFfmpegStatus('FFmpeg 加载失败!', true);
            log(`错误: ${error}`);
        }
    };

    const loadFFmpeg = async () => {
        if (!ffmpeg.loaded) {
            updateFfmpegStatus('正在加载 FFmpeg 核心...', false);
            try {
                await ffmpeg.load({
                    coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js"
                });
                updateFfmpegStatus('FFmpeg 已加载', false);
                startBtn.disabled = false;
            } catch(e) {
                console.error(e);
                updateFfmpegStatus('FFmpeg 加载失败!', true);
                log(`错误: FFmpeg核心加载失败. ${e}`);
            }
        }
    }

    // --- UI Event Listeners ---
    dropArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('dragover'), false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('dragover'), false);
    });

    dropArea.addEventListener('drop', handleFileDrop, false);
    
    splitCheck.addEventListener('change', toggleSplitOptions);
    splitOptions.addEventListener('change', toggleCustomSplitInput);

    startBtn.addEventListener('click', startExtraction);

    // --- UI Logic Functions ---
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function handleFileDrop(e) {
        selectedFiles = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('video/'));
        updateFileListView();
    }

    function handleFileSelect(e) {
        selectedFiles = Array.from(e.target.files);
        updateFileListView();
    }
    
    function updateFileListView() {
        fileList.innerHTML = ''; // Clear list
        if (selectedFiles.length === 0) {
            fileList.appendChild(noFilesSelected);
        } else {
            selectedFiles.forEach(file => {
                const li = document.createElement('li');
                li.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
                fileList.appendChild(li);
            });
        }
    }

    function toggleSplitOptions() {
        const enabled = splitCheck.checked;
        splitOptions.disabled = !enabled;
        if (!enabled) {
            splitOptions.value = 'no-split';
        }
        toggleCustomSplitInput();
    }
    
    function toggleCustomSplitInput() {
        customSplitInput.disabled = !(splitCheck.checked && splitOptions.value === 'custom');
    }

    function setUiBusy(isBusy) {
        startBtn.disabled = isBusy;
        fileInput.disabled = isBusy;
        startBtn.textContent = isBusy ? '处理中...' : '开始提取';
    }

    function log(message) {
        if (logOutput.textContent === '等待开始处理...') {
            logOutput.textContent = '';
        }
        logOutput.textContent += message + '\n';
        logOutput.scrollTop = logOutput.scrollHeight;
    }

    function updateProgress(value, label = `${value}%`) {
        progressBar.value = value;
        progressLabel.textContent = label;
    }
    
    function updateFfmpegStatus(message, isError) {
        ffmpegStatusLabel.textContent = message;
        ffmpegStatusLabel.style.color = isError ? 'var(--error-color)' : 'var(--secondary-color)';
    }

    function createDownloadLink(data, filename) {
        const blob = new Blob([data.buffer], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.textContent = `下载 ${filename}`;
        downloadLinks.appendChild(a);
    }
    
    // --- Core FFmpeg Logic ---
    async function startExtraction() {
        if (selectedFiles.length === 0) {
            alert('请选择至少一个视频文件。');
            return;
        }

        if (!ffmpeg || !ffmpeg.loaded) {
            alert('FFmpeg 尚未加载完成，请稍候。');
            await loadFFmpeg();
            return;
        }

        setUiBusy(true);
        updateProgress(0, '准备中...');
        logOutput.textContent = '开始处理...\n';
        outputArea.style.display = 'none';
        downloadLinks.innerHTML = '';

        try {
            const speed = parseFloat(speedInput.value) || 1.0;
            const doDownsample = downsampleCheck.checked;
            const doSplit = splitCheck.checked;
            
            let splitDuration = 0;
            if (doSplit) {
                if (splitOptions.value === 'custom') {
                    splitDuration = parseInt(customSplitInput.value, 10);
                    if (isNaN(splitDuration) || splitDuration <= 0) {
                        throw new Error('自定义分割时长必须是一个大于0的数字。');
                    }
                } else if (splitOptions.value !== 'no-split') {
                    splitDuration = parseInt(splitOptions.value, 10);
                }
            }

            const isBatchMode = selectedFiles.length > 1;
            
            // For batch mode, or single file with splitting, we follow a more complex path
            if (isBatchMode || doSplit) {
                await processBatchAndSegment(speed, doDownsample, splitDuration);
            } else { // Single file, no splitting, simple case
                await processSingleFile(selectedFiles[0], speed, doDownsample);
            }
            log("处理完成！");
        } catch (error) {
            log(`发生错误: ${error.message}`);
            console.error(error);
        } finally {
            setUiBusy(false);
            updateProgress(0); // Reset progress
            // ffmpeg.exit(); // Consider if we need to re-init
        }
    }
    
    async function processSingleFile(file, speed, doDownsample) {
        const outputFilename = `${file.name.split('.').slice(0, -1).join('.')}.mp3`;
        log(`正在处理单个文件: ${file.name}`);
        
        const fileData = await FFmpeg.fetchFile(file);
        await ffmpeg.writeFile(file.name, fileData);
        
        const command = ['-i', file.name, '-vn', '-acodec', 'libmp3lame', '-q:a', '0'];
        if (doDownsample) command.push('-ar', '22050');
        if (speed !== 1.0) command.push('-filter:a', `atempo=${speed}`);
        command.push(outputFilename);
        
        await ffmpeg.exec(command);
        
        const data = await ffmpeg.readFile(outputFilename);
        createDownloadLink(data, outputFilename);
        outputArea.style.display = 'block';
        await ffmpeg.deleteFile(file.name);
        await ffmpeg.deleteFile(outputFilename);
    }
    
    async function processBatchAndSegment(speed, doDownsample, splitDuration) {
        log(`开始批量处理 ${selectedFiles.length} 个文件...`);
        let tempFiles = [];
        let totalProgressRatio = 0;
        const perFileProgress = 1 / selectedFiles.length * 0.7; // 70% for individual processing

        // 1. Process each file individually
        for (const file of selectedFiles) {
            const tempOutput = `temp_${file.name}.mp3`;
            const fileData = await FFmpeg.fetchFile(file);
            await ffmpeg.writeFile(file.name, fileData);

            const command = ['-i', file.name, '-vn', '-acodec', 'libmp3lame', '-q:a', '0'];
            if (doDownsample) command.push('-ar', '22050');
            if (speed !== 1.0) command.push('-filter:a', `atempo=${speed}`);
            command.push(tempOutput);

            log(`预处理: ${file.name}`);
            await ffmpeg.exec(command);
            
            await ffmpeg.deleteFile(file.name);
            tempFiles.push(tempOutput);
            
            totalProgressRatio += perFileProgress;
            updateProgress(Math.round(totalProgressRatio * 100));
        }
        
        // 2. Concatenate and (optionally) segment
        log('所有文件预处理完毕，开始合并...');
        const concatListContent = tempFiles.map(f => `file '${f}'`).join('\n');
        await ffmpeg.writeFile('concat_list.txt', concatListContent);

        const finalCommand = ['-f', 'concat', '-safe', '0', '-i', 'concat_list.txt'];
        
        ffmpeg.on('progress', ({ progress }) => { // Override progress for final step
            const finalProgress = 70 + (progress * 30); // 30% for final processing
            updateProgress(Math.round(finalProgress), `合并/分割中... ${Math.round(finalProgress)}%`);
        });

        if (splitDuration > 0) {
            log(`合并并分割为 ${splitDuration} 秒的片段...`);
            finalCommand.push('-c', 'copy', '-f', 'segment', '-segment_time', `${splitDuration}`, 'output_%03d.mp3');
        } else {
            log('合并为单个文件...');
            finalCommand.push('-c', 'copy', 'output.mp3');
        }
        
        await ffmpeg.exec(finalCommand);
        updateProgress(100, '完成');

        // 3. Create download links for output files
        const files = await ffmpeg.listDir('.');
        for (const f of files) {
            if (f.name.startsWith('output_') && f.name.endsWith('.mp3')) {
                const data = await ffmpeg.readFile(f.name);
                createDownloadLink(data, f.name);
            }
        }
        if (!splitDuration > 0) {
             const data = await ffmpeg.readFile('output.mp3');
             createDownloadLink(data, 'output.mp3');
        }

        outputArea.style.display = 'block';

        // 4. Cleanup
        log('清理临时文件...');
        await ffmpeg.deleteFile('concat_list.txt');
        for (const tempFile of tempFiles) {
            await ffmpeg.deleteFile(tempFile);
        }
    }

    // --- Initial Setup ---
    setUiBusy(true);
    updateFileListView();
    setupFFmpeg();
}); 