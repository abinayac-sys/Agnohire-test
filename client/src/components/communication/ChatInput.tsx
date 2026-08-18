import React, { useRef } from 'react';
import { Send, Paperclip, Smile, Image as ImageIcon, X, FileText } from 'lucide-react';

interface ChatInputProps {
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  handleSendMessage: (type?: 'TEXT' | 'IMAGE' | 'FILE' | 'GIF', explicitMediaUrl?: string) => void;
  selectedFile: File | null;
  setSelectedFile: React.Dispatch<React.SetStateAction<File | null>>;
  filePreviewUrl: string | null;
  setFilePreviewUrl: React.Dispatch<React.SetStateAction<string | null>>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isEmojiOpen: boolean;
  setIsEmojiOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isGifOpen: boolean;
  setIsGifOpen: React.Dispatch<React.SetStateAction<boolean>>;
  emojiList: string[];
  sampleGifs: { name: string; url: string }[];
  handleSendGif: (url: string) => void;
  handleTyping: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  inputText,
  setInputText,
  handleSendMessage,
  selectedFile,
  setSelectedFile,
  filePreviewUrl,
  setFilePreviewUrl,
  handleFileSelect,
  isEmojiOpen,
  setIsEmojiOpen,
  isGifOpen,
  setIsGifOpen,
  emojiList,
  sampleGifs,
  handleSendGif,
  handleTyping
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    handleTyping();
  };

  const removeFile = () => {
    setSelectedFile(null);
    setFilePreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="border-t border-slate-200 bg-white px-6 py-4 flex-shrink-0 relative">
      {/* File Preview */}
      {selectedFile && (
        <div className="mb-3 flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg relative">
          <div className="relative group">
            {filePreviewUrl ? (
              <img src={filePreviewUrl} alt="Preview" className="w-16 h-16 object-cover rounded-md border border-slate-300" />
            ) : (
              <div className="w-16 h-16 bg-slate-200 flex flex-col items-center justify-center rounded-md border border-slate-300 gap-0.5">
                <FileText className="w-6 h-6 text-slate-500" />
                <span className="text-[9px] font-bold text-slate-500 uppercase truncate max-w-[52px]">
                  {selectedFile.name.split('.').pop() || 'file'}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={removeFile}
              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium text-slate-700 truncate">{selectedFile.name}</span>
            <span className="text-xs text-slate-500">{(selectedFile.size / 1024).toFixed(1)} KB</span>
          </div>
        </div>
      )}

      {/* Emoji Picker Popover */}
      {isEmojiOpen && (
        <div className="absolute bottom-20 left-4 bg-white border border-[#E7ECF3] rounded-[16px] p-3 shadow-[0_4px_12px_rgba(16,24,40,0.06)] grid grid-cols-6 gap-2 z-50">
          {emojiList.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => { setInputText(prev => prev + emoji); setIsEmojiOpen(false); }}
              className="text-lg p-1.5 hover:bg-[#F2F7FF] rounded-[8px] transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* GIF Picker Popover */}
      {isGifOpen && (
        <div className="absolute bottom-20 left-16 bg-white border border-[#E7ECF3] rounded-[16px] p-3 shadow-[0_4px_12px_rgba(16,24,40,0.06)] w-64 space-y-2 z-50">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Select GIF</p>
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {sampleGifs.map(gif => (
              <img
                key={gif.url}
                src={gif.url}
                alt={gif.name}
                onClick={() => { handleSendGif(gif.url); setIsGifOpen(false); }}
                className="w-full h-20 rounded-[10px] object-cover cursor-pointer hover:opacity-80 transition-opacity border border-[#E7ECF3]"
              />
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage('TEXT');
        }}
        className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all duration-200"
      >
        <div className="flex items-center gap-1 text-slate-400">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:text-slate-600 hover:bg-slate-200/50 transition-colors"
            title="Attach file"
          >
            <Paperclip size={17} />
          </button>
          <button
            type="button"
            onClick={() => setIsEmojiOpen(!isEmojiOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:text-slate-600 hover:bg-slate-200/50 transition-colors"
            title="Add emoji"
          >
            <Smile size={17} />
          </button>
          <button
            type="button"
            onClick={() => setIsGifOpen(!isGifOpen)}
            className="text-[10px] font-bold h-8 px-2 flex items-center justify-center rounded-lg bg-slate-200/50 text-slate-500 hover:text-slate-700 hover:bg-slate-200 transition-colors"
            title="Insert GIF"
          >
            GIF
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:text-slate-600 hover:bg-slate-200/50 transition-colors"
            title="Attach media"
          >
            <ImageIcon size={17} />
          </button>
        </div>
        <input
          type="text"
          value={inputText}
          onChange={onInputChange}
          placeholder="Type a message..."
          className="flex-1 bg-transparent px-2 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!inputText.trim() && !selectedFile}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
            inputText.trim() || selectedFile
              ? "bg-blue-700 text-white hover:bg-blue-800"
              : "bg-slate-200 text-slate-400"
          }`}
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
};
